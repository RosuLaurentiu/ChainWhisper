import type { WalletFundingRequirement } from './walletFunds';

export type TradeActionConfirmationPolicy = 'always' | 'funding-only';

export type TradeActionConfirmSummaryRow = {
  label: string;
  value: string;
};

export type TradeActionConfirmFundingMove = {
  amountLabel: string;
  assetSymbol: string;
  fromLabel?: string;
  reason?: string;
  toLabel?: string;
};

export type TradeActionConfirmStat = {
  label: string;
  value: string;
};

export type TradeActionConfirmModel = {
  fundingMoves: TradeActionConfirmFundingMove[];
  message: string;
  primaryLabel: string;
  stats: TradeActionConfirmStat[];
  summaryRows: TradeActionConfirmSummaryRow[];
  title: string;
};

export type TradeFundingPreflightInput = {
  actionLabel: string;
  confirmButtonLabel?: string;
  confirmMessage?: string;
  confirmTitle?: string;
  confirmationPolicy?: TradeActionConfirmationPolicy;
  requirements: WalletFundingRequirement[];
  tradeSummary?: TradeActionConfirmSummaryRow[];
};

export class TradeActionConfirmationCancelledError extends Error {
  constructor(message = 'Action cancelled.') {
    super(message);
    this.name = 'TradeActionConfirmationCancelledError';
  }
}

export const isTradeActionConfirmationCancelledError = (
  error: unknown
): error is TradeActionConfirmationCancelledError =>
  error instanceof TradeActionConfirmationCancelledError ||
  (error instanceof Error && error.name === 'TradeActionConfirmationCancelledError');

const uppercaseFirst = (value: string): string => {
  const trimmed = value.trim();
  return trimmed ? `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}` : 'Trade action';
};

export const shouldRequestTradeActionConfirmation = ({
  confirmationPolicy = 'funding-only',
  fundingMoveCount
}: {
  confirmationPolicy?: TradeActionConfirmationPolicy;
  fundingMoveCount: number;
}): boolean => confirmationPolicy === 'always' || fundingMoveCount > 0;

export const buildTradeActionConfirmModel = ({
  actionLabel,
  confirmationPolicy = 'funding-only',
  confirmButtonLabel,
  confirmMessage,
  confirmTitle,
  estimatedFundingPrompts,
  fundingMoves,
  tradeSummary = [],
  transferTransactionCount
}: {
  actionLabel: string;
  confirmationPolicy?: TradeActionConfirmationPolicy;
  confirmButtonLabel?: string;
  confirmMessage?: string;
  confirmTitle?: string;
  estimatedFundingPrompts: number;
  fundingMoves: TradeActionConfirmFundingMove[];
  tradeSummary?: TradeActionConfirmSummaryRow[];
  transferTransactionCount: number;
}): TradeActionConfirmModel => {
  const normalizedAction = actionLabel.trim() || 'continue';
  const hasFundingMoves = fundingMoves.length > 0;
  const stats: TradeActionConfirmStat[] = hasFundingMoves
    ? [
        {
          label: 'Owner prompts',
          value: `${estimatedFundingPrompts}`
        },
        {
          label: 'Transfers',
          value: `${transferTransactionCount}`
        },
        {
          label: 'Then',
          value: normalizedAction
        }
      ]
    : [
        {
          label: 'Next',
          value: 'wallet approval'
        },
        {
          label: 'Action',
          value: normalizedAction
        }
      ];

  return {
    fundingMoves,
    message:
      confirmMessage?.trim() ||
      (hasFundingMoves
        ? 'Move the missing funds into ChainWhisper first, then continue with the trade action.'
        : 'Review this trade action before the wallet approval.'),
    primaryLabel:
      hasFundingMoves
        ? `Move funds and ${normalizedAction}`
        : confirmButtonLabel?.trim() || uppercaseFirst(normalizedAction),
    stats,
    summaryRows: tradeSummary,
    title:
      confirmTitle?.trim() ||
      (hasFundingMoves
        ? `Move funds and ${normalizedAction}`
        : confirmationPolicy === 'always'
          ? `Confirm ${normalizedAction}`
          : uppercaseFirst(normalizedAction))
  };
};
