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

const directV2: NonNullable<TradeSnapshot['v2']> = {
  protocol: 'direct-v2',
  chainId: '7082400',
  contractAddress: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  amountMode: 'public'
};

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
  it('allows non-maker composer counters only on open Direct V2 offers', () => {
    const trade = baseTrade({ escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS, taker, v2: directV2 });

    expect(canCreateCounterOffer(trade, taker.toLowerCase())).toBe(true);
    expect(getCounterOfferUnavailableReason(trade, taker.toLowerCase())).toBe('');
  });

  it('refuses the composer counter for book offers, which use Counter V2 controls', () => {
    const standard = baseTrade({ v2: { ...directV2, protocol: 'standard-v2', contractAddress: TRADE_ESCROW_CONTRACT_ADDRESS } });
    const privateBook = baseTrade({ escrowContract: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS, hiddenLiquidity: true,
      v2: { ...directV2, protocol: 'private-v2', contractAddress: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS } });

    expect(canCreateCounterOffer(standard, taker.toLowerCase())).toBe(false);
    expect(canCreateCounterOffer(privateBook, taker.toLowerCase())).toBe(false);
    expect(canCreateCounterOffer(baseTrade(), taker.toLowerCase())).toBe(false);
    expect(getCounterOfferUnavailableReason(standard, taker.toLowerCase())).not.toMatch(/legacy/i);
  });

  it('keeps counter replacement restricted to the counter recipient', () => {
    const trade = baseTrade({
      escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
      v2: directV2,
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
