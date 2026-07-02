import { describe, expect, it } from 'vitest';
import type { OtcSwapQuoteCandidate } from './otcSwapQuote';
import {
  formatOtcSwapAvailabilityLabel,
  formatOtcSwapFillHistoryNote,
  getOtcSwapLinkedActionModes,
  resolveOtcSwapLinkedActionMode,
  resolveOtcSwapPriceRatioDisplay,
  resolveSwapLimitPrefill,
  resolveSwapActionModeChange,
  resolveSwapTokenFlip
} from './otcSwapUi';

const quote = ({
  buySymbol = 'p.COTI',
  price = 5_000_000_000_000_000_000n,
  sellSymbol = 'p.gCOTI'
}: {
  buySymbol?: string;
  price?: bigint;
  sellSymbol?: string;
} = {}): OtcSwapQuoteCandidate =>
  ({
    trade: {},
    tradeId: 5,
    tradeKey: 'recurring:5',
    escrowContract: '0xrecurring',
    sourceType: 'recurring',
    sellToken: {
      kind: 'private-erc20',
      tokenAddress: '0xsell',
      symbol: sellSymbol,
      decimals: 18,
      key: 'erc20:0xsell'
    },
    buyToken: {
      kind: 'private-erc20',
      tokenAddress: '0xbuy',
      symbol: buySymbol,
      decimals: 18,
      key: 'erc20:0xbuy'
    },
    requestedSellAmountWei: 0n,
    requestedBuyAmountWei: 0n,
    estimatedSellAmountWei: 0n,
    estimatedBuyAmountWei: 0n,
    complete: false,
    price,
    priceScale: 1_000_000_000_000_000_000n,
    availability: { kind: 'terminal' },
    terminalPrefill: {
      kind: 'recurring',
      displayAction: 'sell',
      fillSide: 'buy',
      amountWei: 0n
    }
  }) as OtcSwapQuoteCandidate;

describe('OTC swap action UI model', () => {
  it('switches from Sell to Buy while preserving the visible pair basis', () => {
    expect(
      resolveSwapActionModeChange(
        {
          inputMode: 'sell',
          sellTokenSelection: 'p.gCOTI',
          buyTokenSelection: 'p.COTI',
          sellAmountInput: '10',
          buyAmountInput: '50'
        },
        'buy'
      )
    ).toEqual({
      inputMode: 'buy',
      sellTokenSelection: 'p.COTI',
      buyTokenSelection: 'p.gCOTI',
      sellAmountInput: '',
      buyAmountInput: ''
    });
  });

  it('switches from Buy to Sell while preserving the visible pair basis', () => {
    expect(
      resolveSwapActionModeChange(
        {
          inputMode: 'buy',
          sellTokenSelection: 'p.COTI',
          buyTokenSelection: 'p.gCOTI',
          sellAmountInput: '50',
          buyAmountInput: '10'
        },
        'sell'
      )
    ).toEqual({
      inputMode: 'sell',
      sellTokenSelection: 'p.gCOTI',
      buyTokenSelection: 'p.COTI',
      sellAmountInput: '',
      buyAmountInput: ''
    });
  });

  it('does not disturb token order when the requested mode is already active', () => {
    const state = {
      inputMode: 'sell' as const,
      sellTokenSelection: 'COTI',
      buyTokenSelection: 'WISP',
      sellAmountInput: '1',
      buyAmountInput: '2'
    };

    expect(resolveSwapActionModeChange(state, 'sell')).toBe(state);
  });

  it('keeps the same price ratio when switching between Sell and Buy for the same action token', () => {
    expect(resolveOtcSwapPriceRatioDisplay(quote(), 'sell')).toMatchObject({
      label: '0.2 p.COTI/p.gCOTI',
      basisLabel: 'p.COTI/p.gCOTI',
      isReversed: false
    });
    expect(
      resolveOtcSwapPriceRatioDisplay(
        quote({
          buySymbol: 'p.gCOTI',
          price: 200_000_000_000_000_000n,
          sellSymbol: 'p.COTI'
        }),
        'buy'
      )
    ).toMatchObject({
      label: '0.2 p.COTI/p.gCOTI',
      basisLabel: 'p.COTI/p.gCOTI',
      isReversed: false
    });
  });

  it('flips the price ratio when the visible pair is flipped by the arrow', () => {
    expect(
      resolveOtcSwapPriceRatioDisplay(
        quote({
          buySymbol: 'p.gCOTI',
          price: 200_000_000_000_000_000n,
          sellSymbol: 'p.COTI'
        }),
        'sell'
      )
    ).toMatchObject({
      label: '5 p.gCOTI/p.COTI',
      basisLabel: 'p.gCOTI/p.COTI'
    });
  });

  it('flips the visible pair while keeping the selected action side', () => {
    expect(
      resolveSwapTokenFlip({
        inputMode: 'buy',
        sellTokenSelection: 'p.COTI',
        buyTokenSelection: 'p.gCOTI',
        sellAmountInput: '50',
        buyAmountInput: '10'
      })
    ).toEqual({
      inputMode: 'buy',
      sellTokenSelection: 'p.gCOTI',
      buyTokenSelection: 'p.COTI',
      sellAmountInput: '',
      buyAmountInput: ''
    });
  });

  it('prefills a new limit order from the current Swap sell and buy cards', () => {
    expect(
      resolveSwapLimitPrefill({
        inputMode: 'buy',
        sellTokenSelection: 'p.COTI',
        buyTokenSelection: 'p.gCOTI',
        sellAmountInput: '3',
        buyAmountInput: '10'
      })
    ).toEqual({
      offerTokenSelection: 'p.COTI',
      requestTokenSelection: 'p.gCOTI'
    });
  });

  it('defaults linked one-off orders to their executable sell side', () => {
    const availableModes = getOtcSwapLinkedActionModes({ recurringOrder: null });

    expect(availableModes).toEqual({ sell: true, buy: false });
    expect(resolveOtcSwapLinkedActionMode('buy', availableModes)).toBe('sell');
  });

  it('limits linked recurring orders to their open sides', () => {
    expect(getOtcSwapLinkedActionModes({ recurringOrder: { buySideOpen: true, sellSideOpen: false } })).toEqual({
      sell: true,
      buy: false
    });
    expect(getOtcSwapLinkedActionModes({ recurringOrder: { buySideOpen: false, sellSideOpen: true } })).toEqual({
      sell: false,
      buy: true
    });
    expect(getOtcSwapLinkedActionModes({ recurringOrder: { buySideOpen: true, sellSideOpen: true } })).toEqual({
      sell: true,
      buy: true
    });
  });

  it('shows public availability as the selected side budget', () => {
    const publicQuote = {
      ...quote(),
      complete: true,
      availability: {
        kind: 'known' as const,
        maxBuyAmountWei: 12_500_000_000_000_000_000n,
        maxSellAmountWei: 2_500_000_000_000_000_000n
      }
    };

    expect(formatOtcSwapAvailabilityLabel(publicQuote, 'sell')).toBe('Up to 2.5 p.gCOTI');
    expect(formatOtcSwapAvailabilityLabel(publicQuote, 'buy')).toBe('Up to 12.5 p.COTI');
  });

  it('shows private availability as private liquidity', () => {
    expect(formatOtcSwapAvailabilityLabel(quote(), 'buy')).toBe('Private liquidity');
  });

  it('explains private-liquidity partial fills when the reveal shows less than requested', () => {
    expect(
      formatOtcSwapFillHistoryNote(
        {
          tradeKey: '0xabc:7',
          requestedAmountWei: '10000000000000000000',
          requestedAssetKey: 'private-erc20:0xrequest',
          requestedSymbol: 'p.USDC.e',
          requestedDecimals: 18,
          requestedRole: 'sold',
          privateLiquidity: true,
          timestamp: 1_000
        },
        {
          bought: {
            kind: 'private-erc20',
            tokenAddress: '0xoffer',
            symbol: 'p.COTI',
            decimals: 18,
            amount: '1000000000000000000',
            visible: true
          },
          sold: {
            kind: 'private-erc20',
            tokenAddress: '0xrequest',
            symbol: 'p.USDC.e',
            decimals: 18,
            amount: '6000000000000000000',
            visible: true
          }
        }
      )
    ).toBe('Requested 10 p.USDC.e, filled 6 p.USDC.e. Private liquidity only filled the amount available on this order.');
  });

  it('explains hidden private-liquidity fills before exact amounts are revealable', () => {
    expect(
      formatOtcSwapFillHistoryNote(
        {
          tradeKey: '0xabc:7',
          requestedAmountWei: '10000000000000000000',
          requestedAssetKey: 'private-erc20:0xrequest',
          requestedSymbol: 'p.USDC.e',
          requestedDecimals: 18,
          requestedRole: 'sold',
          privateLiquidity: true,
          timestamp: 1_000
        },
        {
          bought: {
            kind: 'private-erc20',
            tokenAddress: '0xoffer',
            symbol: 'p.COTI',
            decimals: 18,
            amount: '0',
            visible: false
          },
          sold: {
            kind: 'private-erc20',
            tokenAddress: '0xrequest',
            symbol: 'p.USDC.e',
            decimals: 18,
            amount: '0',
            visible: false
          }
        }
      )
    ).toBe('Requested 10 p.USDC.e. Private liquidity can fill less than requested; exact fill is shown when revealable.');
  });
});
