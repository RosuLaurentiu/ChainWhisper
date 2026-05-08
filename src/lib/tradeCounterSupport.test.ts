import { describe, expect, it } from 'vitest';
import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  RECURRING_OTC_CONTRACT_ADDRESS,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeSnapshot
} from './appShared';
import {
  canCreateCounterOffer,
  canUseWalletAuthorityForDirectAccess,
  getCounterOfferUnavailableReason
} from './tradeCounterSupport';

const maker = '0x1111111111111111111111111111111111111111';
const taker = '0x2222222222222222222222222222222222222222';

const baseTrade = (overrides: Partial<TradeSnapshot> = {}): TradeSnapshot => ({
  tradeId: 1,
  escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
  maker,
  taker: '0x0000000000000000000000000000000000000000',
  offer: {
    kind: 'erc20',
    tokenAddress: '0x3333333333333333333333333333333333333333',
    symbol: 'A',
    decimals: 18,
    amount: '100'
  },
  request: {
    kind: 'erc20',
    tokenAddress: '0x4444444444444444444444444444444444444444',
    symbol: 'B',
    decimals: 18,
    amount: '200'
  },
  createdAt: 1,
  expiresAt: 0,
  status: 'open',
  ...overrides
});

describe('trade counter support', () => {
  it('allows non-maker counters on open standard trades', () => {
    const trade = baseTrade();

    expect(canCreateCounterOffer(trade, taker.toLowerCase())).toBe(true);
    expect(getCounterOfferUnavailableReason(trade, taker.toLowerCase())).toBe('');
  });

  it('allows hidden private-order counters on the upgraded private escrow', () => {
    const trade = baseTrade({
      escrowContract: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
      hiddenLiquidity: true
    });

    expect(canCreateCounterOffer(trade, taker.toLowerCase())).toBe(true);
    expect(getCounterOfferUnavailableReason(trade, taker.toLowerCase())).toBe('');
  });

  it('keeps counter replacement restricted to the counter recipient', () => {
    const trade = baseTrade({
      counterParentTradeId: 4,
      taker
    });

    expect(canCreateCounterOffer(trade, taker.toLowerCase())).toBe(true);
    expect(canCreateCounterOffer(trade, '0x9999999999999999999999999999999999999999')).toBe(false);
  });

  it('lets active Direct fixed-taker trades use wallet authority without requiring the convenience link secret', () => {
    const trade = baseTrade({
      escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
      taker,
      isPublic: false,
      hasAccessHash: true,
      counterParentTradeId: 7
    });

    expect(canUseWalletAuthorityForDirectAccess(trade, taker.toLowerCase())).toBe(true);
    expect(canUseWalletAuthorityForDirectAccess(trade, maker.toLowerCase())).toBe(false);
    expect(canUseWalletAuthorityForDirectAccess({ ...trade, escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS }, taker)).toBe(false);
  });

  it('does not offer counters on recurring orders', () => {
    const trade = baseTrade({
      escrowContract: RECURRING_OTC_CONTRACT_ADDRESS
    });

    expect(canCreateCounterOffer(trade, taker.toLowerCase())).toBe(false);
    expect(getCounterOfferUnavailableReason(trade, taker.toLowerCase())).toBe(
      'Recurring orders do not support counter offers.'
    );
  });
});
