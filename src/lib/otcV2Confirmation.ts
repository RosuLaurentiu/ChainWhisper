import type {
  TradeActionConfirmStat,
  TradeActionConfirmSummaryRow
} from './tradeActionConfirm';

export type OtcV2ApprovalKind = 'erc20' | 'none' | 'private-erc20';

export type OtcV2ConditionalApproval = Readonly<{
  kind: Exclude<OtcV2ApprovalKind, 'none'>;
  symbol: string;
}>;

export type OtcV2ConfirmationDetails = Readonly<{
  confirmMessage: string;
  confirmationStats: TradeActionConfirmStat[];
  tradeSummary: TradeActionConfirmSummaryRow[];
}>;

export type RecurringOtcV2Protocol = 'private-recurring-v2' | 'recurring-v2';

export type RecurringOtcV2ConfirmationCosts = Readonly<{
  actionTransactionCount: number;
  cotiPrivateInputCount: number;
}>;

const plural = (count: number, singular: string): string =>
  `${count} ${singular}${count === 1 ? '' : 's'}`;

const approvalDescription = (approval: OtcV2ConditionalApproval): string => {
  const symbol = approval.symbol.trim() || 'Token';
  return approval.kind === 'private-erc20'
    ? `${symbol}: if needed (1 COTI confirmation + 1 transaction)`
    : `${symbol}: if needed (1 transaction)`;
};

const privateTokenSetupDescription = (approval: OtcV2ConditionalApproval): string => {
  const symbol = approval.symbol.trim() || 'Private token';
  return `${symbol}: if needed (1 one-time transaction)`;
};

export const buildOtcV2ConfirmationDetails = ({
  actionTransactionCount = 1,
  approvals = [],
  cotiPrivateInputCount,
  summaryRows = []
}: {
  actionTransactionCount?: number;
  approvals?: readonly OtcV2ConditionalApproval[];
  cotiPrivateInputCount: number;
  summaryRows?: readonly TradeActionConfirmSummaryRow[];
}): OtcV2ConfirmationDetails => {
  if (!Number.isInteger(actionTransactionCount) || actionTransactionCount <= 0) {
    throw new Error('OTC V2 action transaction count must be a positive integer.');
  }
  if (!Number.isInteger(cotiPrivateInputCount) || cotiPrivateInputCount < 0) {
    throw new Error('OTC V2 private-input count must be a non-negative integer.');
  }

  const privateTokenApprovals = approvals.filter((approval) => approval.kind === 'private-erc20');

  return Object.freeze({
    confirmMessage:
      'Review the exact OTC V2 operation before the wallet request. Contract events update Orders and trade history; no parsed chat message is sent.',
    confirmationStats: [
      {
        label: 'COTI private inputs',
        value:
          cotiPrivateInputCount === 0
            ? '0 confirmations'
            : plural(cotiPrivateInputCount, 'confirmation')
      },
      {
        label: 'On-chain action',
        value: plural(actionTransactionCount, 'transaction')
      },
      {
        label: 'Private token setup',
        value:
          privateTokenApprovals.length === 0
            ? 'None'
            : privateTokenApprovals.map(privateTokenSetupDescription).join('; ')
      },
      {
        label: 'Token approval',
        value:
          approvals.length === 0
            ? 'None'
            : approvals.map(approvalDescription).join('; ')
      },
      {
        label: 'Chat notification',
        value: '0 transactions'
      }
    ],
    tradeSummary: [...summaryRows]
  });
};

export const buildOtcV2ConditionalApproval = ({
  amountWei,
  kind,
  symbol
}: {
  amountWei: bigint;
  kind: OtcV2ApprovalKind;
  symbol: string;
}): OtcV2ConditionalApproval | null =>
  amountWei > 0n && kind !== 'none'
    ? Object.freeze({ kind, symbol })
    : null;

export const resolveRecurringOtcV2ConfirmationCosts = ({
  creating,
  liquidityChanged,
  pricesChanged,
  protocol
}: {
  creating: boolean;
  liquidityChanged: boolean;
  pricesChanged: boolean;
  protocol: RecurringOtcV2Protocol;
}): RecurringOtcV2ConfirmationCosts => {
  if (protocol === 'recurring-v2' || creating) {
    return Object.freeze({
      actionTransactionCount: 1,
      cotiPrivateInputCount: protocol === 'private-recurring-v2' ? 1 : 0
    });
  }

  const actionTransactionCount = Number(pricesChanged) + Number(liquidityChanged);
  if (actionTransactionCount === 0) {
    throw new Error('A private recurring V2 update must change prices or liquidity.');
  }
  return Object.freeze({
    actionTransactionCount,
    cotiPrivateInputCount: liquidityChanged ? 1 : 0
  });
};
