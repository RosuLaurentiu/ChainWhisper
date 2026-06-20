import { describe, expect, it } from 'vitest';
import {
  RECURRING_OTC_CONTRACT_ADDRESS,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetPayload,
  type TradeSnapshot
} from './appShared';
import { quoteBestSingleOtcSwap } from './otcSwapQuote';
import { resolveOtcSwapPriceRatioDisplay } from './otcSwapUi';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const MAKER_ADDRESS = '0xbf0100000000000000000000000000000000ed55';
const ONE = 10n ** 18n;

const asset = (symbol: string, tokenAddress: string, amount = ONE): TradeAssetPayload => ({
  kind: 'private-erc20',
  tokenAddress,
  symbol,
  decimals: 18,
  amount: amount.toString()
});

const oneOffTrade = ({
  id,
  offerAmount,
  requestAmount
}: {
  id: number;
  offerAmount: bigint;
  requestAmount: bigint;
}): TradeSnapshot => ({
  tradeId: id,
  escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
  maker: MAKER_ADDRESS,
  taker: ZERO_ADDRESS,
  offer: asset('p.COTI', '0x00000000000000000000000000000000000000c1', offerAmount),
  request: asset('p.gCOTI', '0x00000000000000000000000000000000000000c2', requestAmount),
  createdAt: 1,
  expiresAt: 0,
  status: 'open',
  isPublic: true,
  hasAccessHash: false
});

const recurringTrade = (): TradeSnapshot => {
  const baseAsset = asset('p.gCOTI', '0x00000000000000000000000000000000000000c2');
  const quoteAsset = asset('p.COTI', '0x00000000000000000000000000000000000000c1');

  return {
    tradeId: 5,
    escrowContract: RECURRING_OTC_CONTRACT_ADDRESS,
    maker: MAKER_ADDRESS,
    taker: ZERO_ADDRESS,
    offer: baseAsset,
    request: quoteAsset,
    createdAt: 1,
    expiresAt: 0,
    status: 'open',
    isPublic: true,
    recurringOrder: {
      orderId: 5,
      selectedSide: 'buy',
      mode: 'fully-private',
      recurringStatus: 'active',
      baseAsset,
      quoteAsset,
      buyTerms: {
        baseAmount: ONE.toString(),
        quoteAmount: (ONE / 5n).toString()
      },
      sellTerms: {
        baseAmount: ONE.toString(),
        quoteAmount: ((ONE * 3n) / 10n).toString()
      },
      publicBaseInventory: '0',
      publicQuoteInventory: '0',
      buySideOpen: true,
      sellSideOpen: true,
      hasPrivateBaseInventory: true,
      hasPrivateQuoteInventory: true,
      executionCount: 0
    }
  };
};

describe('OTC swap quote side selection', () => {
  const pCoti = asset('p.COTI', '0x00000000000000000000000000000000000000c1');
  const pGcoti = asset('p.gCOTI', '0x00000000000000000000000000000000000000c2');

  it('chooses the best sell-side quote without changing the visible basis', () => {
    const result = quoteBestSingleOtcSwap({
      includePrivateOtcQuotes: true,
      inputAmountWei: ONE,
      inputMode: 'sell',
      sellToken: pGcoti,
      buyToken: pCoti,
      trades: [
        oneOffTrade({ id: 7, offerAmount: ONE / 4n, requestAmount: ONE }),
        recurringTrade()
      ]
    });

    expect(result.best?.sourceType).toBe('standard');
    expect(result.best?.tradeId).toBe(7);
    expect(resolveOtcSwapPriceRatioDisplay(result.best, 'sell')).toMatchObject({
      label: '0.25 p.COTI/p.gCOTI',
      basisLabel: 'p.COTI/p.gCOTI'
    });
  });

  it('chooses the best buy-side quote in the same visible basis', () => {
    const result = quoteBestSingleOtcSwap({
      includePrivateOtcQuotes: true,
      inputAmountWei: ONE,
      inputMode: 'buy',
      sellToken: pCoti,
      buyToken: pGcoti,
      trades: [
        oneOffTrade({ id: 7, offerAmount: ONE / 4n, requestAmount: ONE }),
        recurringTrade()
      ]
    });

    expect(result.best?.sourceType).toBe('recurring');
    expect(result.best?.tradeId).toBe(5);
    expect(resolveOtcSwapPriceRatioDisplay(result.best, 'buy')).toMatchObject({
      label: '0.3 p.COTI/p.gCOTI',
      basisLabel: 'p.COTI/p.gCOTI'
    });
  });
});
