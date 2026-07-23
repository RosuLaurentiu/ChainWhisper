import { describe, expect, it } from 'vitest';
import { RECURRING_OTC_CONTRACT_ADDRESS, type TradeSnapshot } from '../../../lib/appShared';
import type { TradeAgentResponseAction } from '../../../lib/tradeAgent';
import type { OtcSwapQuoteCandidate } from '../../../lib/otcSwapQuote';
import {
  resolveTradeAgentOpenOrderSnapshot,
  selectBestExecutableTradeAgentQuote
} from './useP2PTradeAgentActions';

const recurringOrder = {
  tradeId: 5,
  escrowContract: RECURRING_OTC_CONTRACT_ADDRESS
} as TradeSnapshot;

describe('resolveTradeAgentOpenOrderSnapshot', () => {
  it('reuses the cached recurring order selected by the agent', () => {
    expect(
      resolveTradeAgentOpenOrderSnapshot(
        {
          type: 'open_order',
          tradeId: 5,
          escrowContract: RECURRING_OTC_CONTRACT_ADDRESS
        },
        [recurringOrder]
      )
    ).toBe(recurringOrder);
  });

  it('does not reuse an order with the same contract-local id from another escrow', () => {
    expect(
      resolveTradeAgentOpenOrderSnapshot(
        {
          type: 'open_order',
          tradeId: 5,
          escrowContract: RECURRING_OTC_CONTRACT_ADDRESS
        },
        [{ ...recurringOrder, escrowContract: '0x1111111111111111111111111111111111111111' }]
      )
    ).toBeNull();
  });

  it('requires an unambiguous cached contract when the agent omits the escrow', () => {
    expect(
      resolveTradeAgentOpenOrderSnapshot(
        { type: 'open_order', tradeId: 5 } as TradeAgentResponseAction,
        [recurringOrder, { ...recurringOrder, escrowContract: '0x1111111111111111111111111111111111111111' }]
      )
    ).toBeNull();
  });
});

describe('selectBestExecutableTradeAgentQuote', () => {
  const candidate = (
    tradeId: number,
    price: bigint,
    complete: boolean,
    availability: 'known' | 'terminal' = 'known'
  ) => ({
    tradeId,
    price,
    complete,
    availability:
      availability === 'known'
        ? { kind: 'known', maxBuyAmountWei: 100n, maxSellAmountWei: 100n }
        : { kind: 'terminal' }
  }) as OtcSwapQuoteCandidate;

  it('uses amount only to choose the best visibly executable price', () => {
    const incompleteCheapest = candidate(1, 1n, false);
    const executableHigherPrice = candidate(2, 3n, true);
    const executableBestPrice = candidate(3, 2n, true);
    const privateLiquidity = candidate(4, 1n, true, 'terminal');

    expect(
      selectBestExecutableTradeAgentQuote([
        incompleteCheapest,
        executableHigherPrice,
        executableBestPrice,
        privateLiquidity
      ])
    ).toBe(executableBestPrice);
  });

  it('returns no executable claim when visible liquidity cannot cover the amount', () => {
    expect(
      selectBestExecutableTradeAgentQuote([
        candidate(1, 1n, false),
        candidate(2, 2n, true, 'terminal')
      ])
    ).toBeNull();
  });
});
