import type {
  TradeActionConfirmModel,
  TradeActionConfirmSummaryRow
} from './tradeActionConfirm';

export type DirectTradeV2ConfirmationAction =
  | 'create'
  | 'counter'
  | 'replace'
  | 'accept'
  | 'decline'
  | 'cancel';

export type DirectTradeV2ApprovalKind = 'none' | 'erc20' | 'private-erc20';

const actionCopy: Record<DirectTradeV2ConfirmationAction, { title: string; primary: string; verb: string }> = {
  create: { title: 'Confirm Direct V2 offer', primary: 'Create offer', verb: 'create this offer' },
  counter: { title: 'Confirm Direct V2 counter', primary: 'Create counter', verb: 'create this counter offer' },
  replace: { title: 'Confirm Direct V2 replacement', primary: 'Replace offer', verb: 'replace this offer' },
  accept: { title: 'Confirm Direct V2 purchase', primary: 'Buy', verb: 'accept this offer' },
  decline: { title: 'Confirm refusal', primary: 'Refuse offer', verb: 'refuse this offer' },
  cancel: { title: 'Confirm cancellation', primary: 'Cancel offer', verb: 'cancel this offer' }
};

const privateInputCount = (
  action: DirectTradeV2ConfirmationAction,
  privateTerms: boolean
): number => {
  if (!privateTerms) return 0;
  if (action === 'create' || action === 'counter' || action === 'replace') return 2;
  return action === 'accept' ? 1 : 0;
};

const approvalLabel = (kind: DirectTradeV2ApprovalKind, symbol: string): string => {
  if (kind === 'none') return 'None';
  const token = symbol.trim() || 'Token';
  return kind === 'private-erc20'
    ? `${token}: one-time if needed (1 COTI confirmation + 1 transaction)`
    : `${token}: one-time if needed (1 transaction)`;
};

export const buildDirectTradeV2ActionConfirmation = ({
  action,
  approvalKind,
  approvalSymbol = '',
  privateTerms,
  summaryRows = []
}: {
  action: DirectTradeV2ConfirmationAction;
  approvalKind: DirectTradeV2ApprovalKind;
  approvalSymbol?: string;
  privateTerms: boolean;
  summaryRows?: TradeActionConfirmSummaryRow[];
}): TradeActionConfirmModel => {
  const copy = actionCopy[action];
  const cotiInputs = privateInputCount(action, privateTerms);
  return Object.freeze({
    title: copy.title,
    message: `Review the exact Direct Trade V2 operation before the wallet request. The escrow event updates the chat card; no parsed trade message is sent.`,
    primaryLabel: copy.primary,
    summaryRows: [...summaryRows],
    fundingMoves: [],
    stats: [
      {
        label: 'COTI private inputs',
        value: cotiInputs === 0 ? '0 confirmations' : `${cotiInputs} confirmation${cotiInputs === 1 ? '' : 's'}`
      },
      { label: 'On-chain action', value: `1 transaction to ${copy.verb}` },
      { label: 'Token approval', value: approvalLabel(approvalKind, approvalSymbol) },
      { label: 'Chat notification', value: '0 transactions' }
    ]
  });
};
