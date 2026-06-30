import { buildTradeTerminalPath, resolveTradeLinkInput } from '../features/trading/hooks/useP2PTradeRoute';
import {
  isWalletAddress,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeMessageReferencePayload,
  type TradeOfferMessagePayload,
  type TradeSnapshot
} from './appShared';
import { parseChatMessageLinkParts } from './chatLinks';
import { buildOfferFromSnapshot } from './p2pTradeView';
import { isZeroTradeTakerAddress } from './tradePerspective';

export type LinkedTradeContextSource = 'terminal' | 'chat-card' | 'chat-link';

export type LinkedTradeContext = {
  counterpartyAddress?: string;
  escrowContract?: string;
  previewOffer?: TradeOfferMessagePayload;
  shareUrl?: string;
  source: LinkedTradeContextSource;
  terminalPath: string;
  tradeId: number;
};

export type TradeChatTarget = {
  address: string;
  role: 'maker' | 'taker';
};

type LinkedTradeContextInput = {
  counterpartyAddress?: string;
  shareUrl?: string;
  snapshot: TradeSnapshot;
  source: LinkedTradeContextSource;
  terminalPath: string;
};

const normalizeAddressKey = (value?: string | null): string => value?.trim().toLowerCase() ?? '';

const isUsablePeerAddress = (value?: string | null): value is string => {
  const normalized = value?.trim() ?? '';
  return isWalletAddress(normalized) && !isZeroTradeTakerAddress(normalized);
};

export const resolveTradeChatTarget = (
  snapshot: Pick<TradeSnapshot, 'maker' | 'taker'>,
  walletKey: string
): TradeChatTarget | null => {
  const normalizedWalletKey = normalizeAddressKey(walletKey);
  const maker = snapshot.maker.trim();
  const taker = snapshot.taker.trim();
  const makerKey = normalizeAddressKey(maker);

  if (!normalizedWalletKey || !isWalletAddress(maker)) {
    return null;
  }

  if (normalizedWalletKey !== makerKey) {
    return { address: maker, role: 'maker' };
  }

  if (!isUsablePeerAddress(taker) || normalizeAddressKey(taker) === makerKey) {
    return null;
  }

  return { address: taker, role: 'taker' };
};

export const buildLinkedTradeContext = ({
  counterpartyAddress,
  shareUrl,
  snapshot,
  source,
  terminalPath
}: LinkedTradeContextInput): LinkedTradeContext => ({
  counterpartyAddress,
  escrowContract: snapshot.escrowContract ?? TRADE_ESCROW_CONTRACT_ADDRESS,
  previewOffer: buildOfferFromSnapshot(snapshot),
  shareUrl: shareUrl || undefined,
  source,
  terminalPath,
  tradeId: snapshot.tradeId
});

export const buildTradeMessageReferenceFromContext = (
  context: LinkedTradeContext
): TradeMessageReferencePayload => ({
  version: 1,
  tradeId: context.tradeId,
  escrowContract: context.escrowContract ?? TRADE_ESCROW_CONTRACT_ADDRESS,
  terminalPath: buildTradeTerminalPath(context.tradeId, undefined, context.escrowContract ?? TRADE_ESCROW_CONTRACT_ADDRESS)
});

export const extractTradeTerminalPathFromMessage = (text: string, currentOrigin?: string): string | null => {
  for (const part of parseChatMessageLinkParts(text, currentOrigin)) {
    if (part.type !== 'link' || part.external) {
      continue;
    }

    const tradeLink = resolveTradeLinkInput(part.href);
    if (!tradeLink) {
      continue;
    }

    return buildTradeTerminalPath(tradeLink.tradeId, tradeLink.accessSecret, tradeLink.escrowContract);
  }

  return null;
};
