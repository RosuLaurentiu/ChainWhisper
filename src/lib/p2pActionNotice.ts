export type P2PActionNoticeStatus = 'pending' | 'success' | 'error' | 'info';
export type P2PActionNoticeSurface = 'terminal' | 'composer' | 'history';
export type P2PActionNoticeAction =
  | 'accept'
  | 'cancel'
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
};

export type P2PActionNotice = P2PActionNoticeInput & {
  id: string;
  message: string;
  createdAt: number;
};

const successMessageByAction: Record<P2PActionNoticeAction, string> = {
  accept: 'Offer accepted',
  cancel: 'Offer cancelled',
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
  if (status === 'pending') {
    return 'Confirming on-chain...';
  }
  if (status === 'success') {
    return successMessageByAction[action];
  }
  if (status === 'error') {
    return message?.trim() || 'Action failed';
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
