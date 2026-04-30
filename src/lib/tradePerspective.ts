import type { TradeAssetPayload, TradeOnChainStatus, TradeSnapshot } from './appShared';

export const ZERO_TRADE_TAKER_ADDRESS = '0x0000000000000000000000000000000000000000';

export type TradePerspectiveTone = 'send' | 'receive' | 'neutral';
export type TradePerspectiveRole = 'maker' | 'taker' | 'open-taker' | 'unrelated' | 'unknown';

export type TradePerspectiveSide = {
  asset: TradeAssetPayload;
  label: string;
  tone: TradePerspectiveTone;
};

export type TradePerspective = {
  walletKey: string;
  role: TradePerspectiveRole;
  isMaker: boolean;
  isTaker: boolean;
  isOpenTakerTrade: boolean;
  isParticipant: boolean;
  showTakerPerspective: boolean;
  offerSide: TradePerspectiveSide;
  requestSide: TradePerspectiveSide;
  sendSide: TradePerspectiveSide | null;
  receiveSide: TradePerspectiveSide | null;
  canAccept: boolean;
  needsAction: boolean;
  isMyActiveOffer: boolean;
  isHistory: boolean;
};

type TradePerspectiveInput = Pick<TradeSnapshot, 'maker' | 'taker' | 'offer' | 'request'> & {
  status?: TradeOnChainStatus;
};

const normalizeAddress = (value?: string | null): string => value?.trim().toLowerCase() ?? '';

export const isZeroTradeTakerAddress = (value?: string | null): boolean =>
  normalizeAddress(value) === ZERO_TRADE_TAKER_ADDRESS;

export const resolveTradePerspective = (
  trade: TradePerspectiveInput,
  walletAddress?: string | null
): TradePerspective => {
  const walletKey = normalizeAddress(walletAddress);
  const makerKey = normalizeAddress(trade.maker);
  const takerKey = normalizeAddress(trade.taker);
  const isMaker = Boolean(walletKey && makerKey === walletKey);
  const isTaker = Boolean(walletKey && takerKey === walletKey);
  const isOpenTakerTrade = isZeroTradeTakerAddress(trade.taker);
  const isOpen = trade.status === undefined || trade.status === 'open';
  const showTakerPerspective = Boolean(walletKey && !isMaker && (isTaker || isOpenTakerTrade));
  const role: TradePerspectiveRole = isMaker
    ? 'maker'
    : isTaker
      ? 'taker'
      : showTakerPerspective
        ? 'open-taker'
        : walletKey
          ? 'unrelated'
          : 'unknown';
  const offerSide: TradePerspectiveSide = {
    asset: trade.offer,
    label: isMaker ? 'You send' : showTakerPerspective ? 'You receive' : 'Maker sends',
    tone: isMaker ? 'send' : showTakerPerspective ? 'receive' : 'send'
  };
  const requestSide: TradePerspectiveSide = {
    asset: trade.request,
    label: isMaker ? 'You receive' : showTakerPerspective ? 'You send' : 'Maker wants',
    tone: isMaker ? 'receive' : showTakerPerspective ? 'send' : 'receive'
  };
  const sendSide = isMaker ? offerSide : showTakerPerspective ? requestSide : null;
  const receiveSide = isMaker ? requestSide : showTakerPerspective ? offerSide : null;
  const canAccept = isOpen && !isMaker && Boolean(walletKey && (isTaker || isOpenTakerTrade));
  const needsAction = isOpen && isTaker;
  const isMyActiveOffer = isOpen && isMaker;
  const isParticipant = isMaker || isTaker;

  return {
    walletKey,
    role,
    isMaker,
    isTaker,
    isOpenTakerTrade,
    isParticipant,
    showTakerPerspective,
    offerSide,
    requestSide,
    sendSide,
    receiveSide,
    canAccept,
    needsAction,
    isMyActiveOffer,
    isHistory: isParticipant && !isOpen
  };
};

export const groupWalletTradesByPerspective = (trades: TradeSnapshot[], walletAddress: string) => {
  const needsAction: TradeSnapshot[] = [];
  const myActiveOffers: TradeSnapshot[] = [];
  const history: TradeSnapshot[] = [];

  for (const trade of trades) {
    const perspective = resolveTradePerspective(trade, walletAddress);
    if (perspective.needsAction) {
      needsAction.push(trade);
    } else if (perspective.isMyActiveOffer) {
      myActiveOffers.push(trade);
    } else if (perspective.isHistory) {
      history.push(trade);
    }
  }

  return { needsAction, myActiveOffers, history };
};
