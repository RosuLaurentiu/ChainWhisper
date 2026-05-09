import { describe, expect, it } from 'vitest';
import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  RECURRING_OTC_CONTRACT_ADDRESS
} from '../lib/appShared/core';
import { encodeTradeLink } from '../lib/tradeLinks';
import { buildTradeLinkPath, resolveTradeLinkInput, resolveTradeRouteFromParts } from './useP2PTradeRoute';

const ACCESS_SECRET = `0x${'12'.repeat(32)}`;

describe('P2P trade route helpers', () => {
  it('resolves top-level trade routes without changing route ownership', () => {
    expect(resolveTradeRouteFromParts('/trades')).toMatchObject({ view: 'public', tradeId: null });
    expect(resolveTradeRouteFromParts('/trades/create')).toMatchObject({ view: 'create', tradeId: null });
    expect(resolveTradeRouteFromParts('/trades/mine')).toMatchObject({ view: 'mine', tradeId: null });
    expect(resolveTradeRouteFromParts('/trades/recurring')).toMatchObject({ view: 'create', tradeId: null });
    expect(resolveTradeRouteFromParts('/trades/recurring', '?order=11')).toMatchObject({
      view: 'trade',
      tradeId: 11,
      escrowContract: RECURRING_OTC_CONTRACT_ADDRESS
    });
    expect(resolveTradeRouteFromParts('/trades/open')).toMatchObject({ view: 'trade', tradeId: null });
    expect(resolveTradeRouteFromParts('/trades/open/counter')).toMatchObject({ view: 'counter', tradeId: null });
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
    expect(resolveTradeRouteFromParts(`/trades/l/${code}`, '?escrow=direct')).toMatchObject({
      view: 'trade',
      tradeId: 42,
      escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
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
    const bareCode = encodeTradeLink(9, ACCESS_SECRET);
    expect(resolveTradeLinkInput(bareCode)).toEqual({ tradeId: 9, accessSecret: ACCESS_SECRET });
    expect(resolveTradeLinkInput('#123')).toEqual({ tradeId: 123 });
    expect(resolveTradeLinkInput(`http://localhost:5173/trades/recurring?order=7#${ACCESS_SECRET}`)).toEqual({
      tradeId: 7,
      escrowContract: RECURRING_OTC_CONTRACT_ADDRESS,
      accessSecret: ACCESS_SECRET
    });
    expect(resolveTradeLinkInput('123abc')).toBeNull();
  });

  it('preserves recurring private-link secrets in share paths', () => {
    expect(buildTradeLinkPath(7, ACCESS_SECRET, RECURRING_OTC_CONTRACT_ADDRESS)).toBe(
      `/trades/recurring?order=7#${ACCESS_SECRET}`
    );
    expect(buildTradeLinkPath(8, ACCESS_SECRET, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS)).toBe(
      `/trades/l/${encodeTradeLink(8, ACCESS_SECRET)}?escrow=direct`
    );
  });
});
