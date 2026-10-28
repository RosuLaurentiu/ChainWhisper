import type { TradeAssetPayload } from './appShared';

export type P2PActionNoticeStatus = 'wallet' | 'pending' | 'success' | 'error' | 'uncertain' | 'info';
export type P2PActionNoticeSurface = 'terminal' | 'composer' | 'history';
export type P2PActionNoticeAction =
  | 'accept'
  | 'cancel'
  | 'budget-visibility'
  | 'counter'
  | 'create-offer'
  | 'create-recurring-order'
  | 'decline'
  | 'fill'
  | 'recurring-close'
  | 'recurring-liquidity'
  | 'recurring-update'
  | 'reveal';

export type P2PActionNoticeInput = {
  action: P2PActionNoticeAction;
  status: P2PActionNoticeStatus;
  surface: P2PActionNoticeSurface;
  message?: string;
  tradeKey?: string;
  txHash?: string;
  requestedFill?: {
    amountWei: string;
    asset: Pick<TradeAssetPayload, 'kind' | 'tokenAddress' | 'symbol' | 'decimals'>;
    role: 'sold' | 'bought';
    privateLiquidity: boolean;
  };
};

const UNCERTAIN_OUTCOME_PATTERN = /(?:transaction|action|trade|order).*(?:submitted|broadcast).*(?:confirmation|receipt).*(?:timed out|unavailable)|(?:confirmation|receipt).*(?:timed out|unavailable).*(?:submitted|broadcast)/iu;

export const getP2PActionFailureStatus = (message: string): Extract<P2PActionNoticeStatus, 'error' | 'uncertain'> =>
  UNCERTAIN_OUTCOME_PATTERN.test(message.trim()) ? 'uncertain' : 'error';

export type P2PActionNotice = P2PActionNoticeInput & {
  id: string;
  message: string;
  createdAt: number;
};

const successMessageByAction: Record<P2PActionNoticeAction, string> = {
  accept: 'Offer accepted',
  cancel: 'Offer cancelled',
  'budget-visibility': 'Budget visibility changed',
  counter: 'Counter sent',
  'create-offer': 'Offer opened',
  'create-recurring-order': 'Order opened',
  decline: 'Offer refused',
  fill: 'Trade filled',
  'recurring-close': 'Order closed',
  'recurring-liquidity': 'Liquidity changed',
  'recurring-update': 'Order updated',
  reveal: 'Private history revealed'
};

export const getP2PActionNoticeMessage = ({
  action,
  message,
  status
}: Pick<P2PActionNoticeInput, 'action' | 'message' | 'status'>): string => {
  if (status === 'wallet') {
    return 'Confirm this action in your wallet';
  }
  if (status === 'pending') {
    return 'Confirming on-chain...';
  }
  if (status === 'success') {
    return successMessageByAction[action];
  }
  if (status === 'error') {
    return message?.trim() || 'Action failed';
  }
  if (status === 'uncertain') {
    return message?.trim() || 'Confirmation is still uncertain. Check wallet activity before retrying.';
  }
  return message?.trim() || successMessageByAction[action];
};

export const buildP2PActionNotice = (input: P2PActionNoticeInput): P2PActionNotice => {
  const createdAt = Date.now();
  return {
    ...input,
    id: `${input.surface}:${input.action}:${input.status}:${createdAt}`,
    message: getP2PActionNoticeMessage(input),
    createdAt
  };
};

export const getP2PActionNoticeAutoDismissMs = (status: P2PActionNoticeStatus): number | null =>
  status === 'success' || status === 'info' ? 6500 : null;
