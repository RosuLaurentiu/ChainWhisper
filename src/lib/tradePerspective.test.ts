import { describe, expect, it } from 'vitest';
import type { TradeAssetPayload, TradeSnapshot } from './appShared';
import { groupWalletTradesByPerspective, resolveTradePerspective, ZERO_TRADE_TAKER_ADDRESS } from './tradePerspective';

const maker = '0x1111111111111111111111111111111111111111';
const taker = '0x2222222222222222222222222222222222222222';
const other = '0x3333333333333333333333333333333333333333';

const asset = (symbol: string): TradeAssetPayload => ({
  kind: 'erc20',
  tokenAddress: `0x${symbol.toLowerCase().padEnd(40, '0').slice(0, 40)}`,
  symbol,
  decimals: 18,
  amount: '1000000000000000000'
});

const trade = (overrides: Partial<TradeSnapshot> = {}): TradeSnapshot => ({
  tradeId: overrides.tradeId ?? 1,
  maker,
  taker,
  offer: asset('AAA'),
  request: asset('BBB'),
  createdAt: 1,
  expiresAt: 2,
  status: 'open',
  ...overrides
});

describe('resolveTradePerspective', () => {
  it('labels maker perspective as send offer and receive request', () => {
    const perspective = resolveTradePerspective(trade(), maker);
    expect(perspective.role).toBe('maker');
    expect(perspective.offerSide).toMatchObject({ label: 'You send', tone: 'send' });
    expect(perspective.requestSide).toMatchObject({ label: 'You receive', tone: 'receive' });
  });

  it('labels taker perspective as send request and receive offer', () => {
    const perspective = resolveTradePerspective(trade(), taker);
    expect(perspective.role).toBe('taker');
    expect(perspective.offerSide).toMatchObject({ label: 'You receive', tone: 'receive' });
    expect(perspective.requestSide).toMatchObject({ label: 'You send', tone: 'send' });
    expect(perspective.needsAction).toBe(true);
  });

  it('allows any connected non-maker wallet to view an open public trade as taker', () => {
    const perspective = resolveTradePerspective(trade({ taker: ZERO_TRADE_TAKER_ADDRESS }), other);
    expect(perspective.role).toBe('open-taker');
    expect(perspective.canAccept).toBe(true);
    expect(perspective.requestSide).toMatchObject({ label: 'You send', tone: 'send' });
  });

  it('labels maker terms when no wallet role is known', () => {
    const perspective = resolveTradePerspective(trade(), '');
    expect(perspective.role).toBe('unknown');
    expect(perspective.offerSide).toMatchObject({ label: 'Maker sends', tone: 'send' });
    expect(perspective.requestSide).toMatchObject({ label: 'Maker wants', tone: 'receive' });
  });
});

describe('groupWalletTradesByPerspective', () => {
  it('groups wallet trades by action, active offers, and history', () => {
    const needsAction = trade({ tradeId: 1, taker });
    const myActiveOffer = trade({ tradeId: 2, maker: taker, taker: ZERO_TRADE_TAKER_ADDRESS });
    const history = trade({ tradeId: 3, maker: taker, status: 'accepted' });

    expect(groupWalletTradesByPerspective([needsAction, myActiveOffer, history], taker)).toEqual({
      needsAction: [needsAction],
      myActiveOffers: [myActiveOffer],
      history: [history]
    });
  });
});
