import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTradeCustomTokenInfoKey, type TradeCustomTokenInfo } from '../../../lib/appHelpers';
import type { LinkTradeV2Review } from '../../../lib/linkTradeV2';
import LinkTradeV2Terminal, { LinkTradeV2ReviewDetails } from './LinkTradeV2Terminal';
import { LinkTradeV2UnavailableError } from '../../../lib/linkTradeV2';

const hooks = vi.hoisted(() => ({ enabled: false, index: 0, slots: [] as unknown[], memo: null as unknown,
  effect: undefined as (() => unknown) | undefined, read: vi.fn() }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  return { ...actual,
    useMemo: (read: () => unknown, deps: unknown[]) => hooks.enabled ? hooks.memo ??= read() : actual.useMemo(read, deps),
    useEffect: (run: () => void, deps: unknown[]) => { if (hooks.enabled) hooks.effect = run; else actual.useEffect(run, deps); },
    useState: (initial: unknown) => {
      if (!hooks.enabled) return actual.useState(initial);
      const index = hooks.index++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [hooks.slots[index], (next: unknown) => { hooks.slots[index] = typeof next === 'function' ? next(hooks.slots[index]) : next; }];
    }
  };
});
vi.mock('../../../lib/linkTradeV2', async original => ({ ...await original<typeof import('../../../lib/linkTradeV2')>(),
  readLinkTradeV2CurrentReview: hooks.read }));
afterEach(() => { hooks.enabled = false; hooks.index = 0; hooks.slots = []; hooks.memo = null; hooks.effect = undefined; hooks.read.mockReset(); });

const reference = { chainId: '7082400', escrow: `0x${'11'.repeat(20)}`,
  id: ((1n << 256n) - 1n).toString(), revision: '2', credentialEpoch: '1' };
const secret = `0x${'ab'.repeat(32)}`, a = `0x${'22'.repeat(20)}`, b = `0x${'33'.repeat(20)}`;
const review = { reference, terms: { offerToken: a, requestToken: b, privatePair: true,
  priceOffer: '1000000', priceRequest: '1500000', expiresAt: '0' } } as LinkTradeV2Review;
const token = (address: string, symbol: string): TradeCustomTokenInfo => ({
  address, symbol, kind: 'private-erc20', decimals: 6, balanceWei: null, loading: false
});
const tokens = { [buildTradeCustomTokenInfoKey('private-erc20', a)]: token(a, 'HBR'),
  [buildTradeCustomTokenInfoKey('private-erc20', b)]: token(b, 'BCN') };

describe('Link trade review presentation', () => {
  it.each([true, false])('distinguishes canonical unavailability from a failed read (unavailable=%s)', async unavailable => {
    hooks.enabled = true;
    hooks.read.mockRejectedValue(unavailable ? new LinkTradeV2UnavailableError('Link order is closed, expired or revoked.') : new Error('Read failed'));
    const renderFill = vi.fn(), renderCounter = vi.fn();
    const render = () => {
      hooks.index = 0;
      return renderToStaticMarkup(createElement(LinkTradeV2Terminal, { reference, secret, tokenInfoByKey: {},
        readContext: {} as never, renderFill, renderCounter }));
    };
    expect(render()).toContain('Loading shared trade');
    hooks.effect?.();
    await vi.waitFor(() => expect(hooks.slots[1]).not.toBeNull());
    const html = render();
    if (unavailable) {
      expect(html).toContain('This shared trade is closed or unavailable.');
      expect(html).not.toContain('Retry');
      expect(html).not.toContain('Could not load');
    } else { expect(html).toContain('Could not load'); expect(html).toContain('Retry'); }
    expect(renderFill).not.toHaveBeenCalled(); expect(renderCounter).not.toHaveBeenCalled();
    expect(hooks.read).toHaveBeenCalledOnce(); expect(html).not.toContain(secret);
  });
  it('reports missing credentials or deployment honestly without showing a legacy ID prompt', () => {
    const missing = renderToStaticMarkup(createElement(LinkTradeV2Terminal, { reference, secret: '', tokenInfoByKey: {} }));
    expect(missing).toContain('full Share link');
    const inactive = renderToStaticMarkup(createElement(LinkTradeV2Terminal, { reference, secret, tokenInfoByKey: {} }));
    expect(inactive).toContain('not available in this App deployment');
    expect(inactive).not.toContain(secret);
    expect(inactive).not.toContain('trade id');
  });
  it('shows exact token-aware price points and keeps technical identity under details', () => {
    const html = renderToStaticMarkup(createElement(LinkTradeV2ReviewDetails, { review, tokenInfoByKey: tokens }));
    expect(html).toContain('1.0 HBR for 1.5 BCN');
    expect(html).toContain('Private trade');
    expect(html).toContain('Partial fills');
    expect(html).toContain('<summary>Trade details</summary>');
    expect(html).toContain(reference.id);
    expect(html).not.toContain(secret);
    expect(html).not.toContain('Balance: 0');
  });
  it('can load shared-Link review through the read-only resolver while submissions remain unavailable', () => {
    const html = renderToStaticMarkup(createElement(LinkTradeV2Terminal, { reference, secret, tokenInfoByKey: {},
      resolveReadContext: async () => { throw new Error('The server render must not make a chain request.'); } }));
    expect(html).toContain('Loading shared trade');
    expect(html).not.toContain('not available in this App deployment'); expect(html).not.toContain(secret);
  });
  it('does not guess price units when token metadata is unavailable or invalid', () => {
    const html = renderToStaticMarkup(createElement(LinkTradeV2ReviewDetails, { review, tokenInfoByKey: {} }));
    expect(html).toContain('Token details unavailable');
    expect(html).not.toContain('1000000');
    const invalid = { ...tokens, [buildTradeCustomTokenInfoKey('private-erc20', a)]: { ...token(a, 'HBR'), decimals: 999 } };
    expect(renderToStaticMarkup(createElement(LinkTradeV2ReviewDetails, { review, tokenInfoByKey: invalid })))
      .not.toContain('1.0 HBR');
  });
});
