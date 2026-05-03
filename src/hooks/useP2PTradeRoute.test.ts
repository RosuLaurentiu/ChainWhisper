import { describe, expect, it } from 'vitest';
import { PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS } from '../lib/appShared/core';
import { encodeTradeLink } from '../lib/tradeLinks';
import { resolveTradeLinkInput, resolveTradeRouteFromParts } from './useP2PTradeRoute';

const ACCESS_SECRET = `0x${'12'.repeat(32)}`;

describe('P2P trade route helpers', () => {
  it('resolves top-level trade routes without changing route ownership', () => {
    expect(resolveTradeRouteFromParts('/trades')).toMatchObject({ view: 'public', tradeId: null });
    expect(resolveTradeRouteFromParts('/trades/create')).toMatchObject({ view: 'create', tradeId: null });
    expect(resolveTradeRouteFromParts('/trades/mine')).toMatchObject({ view: 'mine', tradeId: null });
    expect(resolveTradeRouteFromParts('/trades/open')).toMatchObject({ view: 'trade', tradeId: null });
  });

  it('resolves compact private trade links with escrow aliases', () => {
    const code = encodeTradeLink(42, ACCESS_SECRET);

    expect(resolveTradeRouteFromParts(`/trades/l/${code}`, '?escrow=private')).toMatchObject({
      view: 'trade',
      tradeId: 42,
      escrowContract: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
      accessSecret: ACCESS_SECRET,
      routeError: ''
    });
  });

  it('preserves legacy numeric links and secret hashes', () => {
    expect(resolveTradeRouteFromParts('/trades/77', '', `#${ACCESS_SECRET}`)).toMatchObject({
      view: 'trade',
      tradeId: 77,
      accessSecret: ACCESS_SECRET
    });
  });

  it('parses shared input while rejecting partial numeric text', () => {
    expect(resolveTradeLinkInput('#123')).toEqual({ tradeId: 123 });
    expect(resolveTradeLinkInput('123abc')).toBeNull();
  });
});
