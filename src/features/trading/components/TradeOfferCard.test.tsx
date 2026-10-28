import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetPayload,
  type TradeOfferMessagePayload,
  type TradeSnapshot
} from '../../../lib/appShared';
import TradeOfferCard from './TradeOfferCard';

const maker = '0x1111111111111111111111111111111111111111';
const taker = '0x2222222222222222222222222222222222222222';

const asset = (symbol: string): TradeAssetPayload => ({
  kind: 'private-erc20',
  tokenAddress: `0x${symbol.toLowerCase().padEnd(40, '0').slice(0, 40)}`,
  symbol,
  decimals: 6,
  amount: '0'
});

const offer: TradeOfferMessagePayload = {
  version: 2,
  tradeId: 3,
  escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  maker,
  taker,
  offer: asset('cwTPB'),
  request: asset('cwTPQ'),
  createdAt: 1,
  expiresAt: 0,
  hiddenLiquidity: true
};

const snapshot: TradeSnapshot = {
  tradeId: 3,
  escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  maker,
  taker,
  offer: offer.offer!,
  request: offer.request!,
  createdAt: 1,
  expiresAt: 0,
  status: 'open',
  hiddenLiquidity: true,
  v2: {
    protocol: 'direct-v2',
    chainId: '7082400',
    contractAddress: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
    amountMode: 'private'
  }
};

const render = (onRevealTerms?: () => void): string => renderToStaticMarkup(createElement(TradeOfferCard, {
  offer,
  snapshot,
  currentWalletAddress: taker,
  actionPending: false,
  onRevealTerms,
  onAccept: () => {},
  onDecline: () => {},
  onCounter: () => {},
  onCancel: () => {}
}));

const revealButton = (markup: string): string => {
  const match = markup.match(/<button[^>]*class="trade-card-action trade-card-action-accept"[^>]*>Reveal terms to continue<\/button>/);
  if (!match) throw new Error('Expected the Direct terms reveal button.');
  return match[0];
};

describe('TradeOfferCard Direct V2 reveal retry', () => {
  it('enables the existing reveal button when privacy can retry participant terms', () => {
    expect(revealButton(render(() => {}))).not.toContain('disabled');
  });

  it('keeps the reveal button disabled while the privacy reader is unavailable', () => {
    expect(revealButton(render())).toContain('disabled');
  });

  it('renders a retired escrow card as archived instead of waiting forever', () => {
    const archivedOffer: TradeOfferMessagePayload = {
      ...offer,
      escrowContract: '0x3333333333333333333333333333333333333333',
      offer: undefined,
      request: undefined,
      hiddenLiquidity: false,
      expiresAt: 1
    };
    const markup = renderToStaticMarkup(createElement(TradeOfferCard, {
      offer: archivedOffer,
      actionPending: false,
      termsUnavailableReason: 'Archived offer details are unavailable on this network.',
      onAccept: () => {},
      onDecline: () => {},
      onCounter: () => {},
      onCancel: () => {}
    }));

    expect(markup).toContain('Archived offer details are unavailable on this network.');
    expect(markup).not.toContain('Loading from contract...');
  });
});
