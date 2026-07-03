import { describe, expect, it } from 'vitest';
import type { TradeSnapshot } from '../../../lib/appShared';
import { buildActiveCarbonPairRequests } from './useCarbonPairReferences';

const baseAsset = {
  kind: 'erc20' as const,
  symbol: 'BASE',
  tokenAddress: '0x1111111111111111111111111111111111111111'
};
const quoteAsset = {
  kind: 'erc20' as const,
  symbol: 'QUOTE',
  tokenAddress: '0x2222222222222222222222222222222222222222'
};
const pairKey = `${baseAsset.tokenAddress}:${quoteAsset.tokenAddress}`;

describe('buildActiveCarbonPairRequests', () => {
  it('collects composer pairs on create routes', () => {
    expect(
      buildActiveCarbonPairRequests({
        routeSurfaceView: 'create',
        routeView: 'create',
        terminalPanelTrade: null,
        tradeComposerOfferToken: baseAsset,
        tradeComposerRequestToken: quoteAsset,
        walletAddress: ''
      })
    ).toEqual([
      {
        baseAsset,
        pairKey,
        quoteAsset
      }
    ]);
  });

  it('dedupes matching swap and terminal recurring pairs', () => {
    const terminalPanelTrade = {
      recurringOrder: {
        baseAsset,
        quoteAsset
      }
    } as unknown as TradeSnapshot;

    expect(
      buildActiveCarbonPairRequests({
        routeSurfaceView: 'swap',
        routeView: 'swap',
        swapBuyToken: baseAsset,
        swapSellToken: quoteAsset,
        terminalPanelTrade,
        walletAddress: ''
      })
    ).toEqual([
      {
        baseAsset,
        pairKey,
        quoteAsset
      }
    ]);
  });
});
