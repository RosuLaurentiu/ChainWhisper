import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TradeSnapshot } from '../../../lib/appShared';
import TradeMyTradesSection, { type MyTradeGroupOption } from './TradeMyTradesSection';

vi.mock('./TradeOrderLists', () => ({
  TradeMyOrderList: ({ trades, emptyState }: { trades: TradeSnapshot[]; emptyState?: ReactNode }) => trades.length
    ? <div>{trades.map(trade => <article key={trade.tradeId}>Known public offer #{trade.tradeId}</article>)}</div>
    : emptyState
}));

const wallet = '0x1111111111111111111111111111111111111111';
const publicTrade: TradeSnapshot = {
  tradeId: 7, maker: wallet, taker: '0x2222222222222222222222222222222222222222',
  offer: { kind: 'erc20', tokenAddress: '0x3333333333333333333333333333333333333333', symbol: 'cwPTA', decimals: 6, amount: '1000000' },
  request: { kind: 'erc20', tokenAddress: '0x4444444444444444444444444444444444444444', symbol: 'cwPTB', decimals: 6, amount: '2000000' },
  status: 'open', createdAt: 1, expiresAt: 0, isPublic: true
};
const group = (id: MyTradeGroupOption['id'], trades: TradeSnapshot[] = []): MyTradeGroupOption => ({
  id, label: id === 'history' ? 'History' : id === 'received' ? 'Received' : 'Active', mobileLabel: id, subLabel: id,
  description: `${id} trades`, count: trades.length, trades,
  emptyTitle: id === 'history' ? 'No trade history' : id === 'received' ? 'No received trades' : 'No active trades',
  emptyDescription: 'Your trades will appear here.', emptySearchTitle: 'No matching trades', emptySearchMessage: 'No matches'
});
type Props = ComponentProps<typeof TradeMyTradesSection> & { privateTradesLocked?: boolean };
const render = (patch: Partial<Props> = {}, history = false, knownPublic = false): string => {
  const groups = [group('received'), group('active', knownPublic ? [publicTrade] : []), group('history')];
  const props: Props = {
    walletAddress: wallet, walletKey: wallet, walletReadAccounts: [], routeView: 'mine', reversedRateTradeIds: {}, lastCopiedKey: '',
    openTradeSnapshot: vi.fn(), toggleTradeRateDirection: vi.fn(), resolveKnownTradeAccessSecret: () => '', buildTradeShareUrl: () => '', copyWithFeedback: async () => {},
    loadingMyTrades: false, myTradesCount: knownPublic ? 1 : 0, myTradesError: '', myTradeGroupOptions: groups,
    selectedMyTradeGroup: groups[history ? 2 : 1], selectedTradeKey: '', hasActiveDeskFilters: false, mobileTradeFiltersOpen: false,
    activeAdvancedTradeFilterCount: 0, tradeSearchSummary: '', tradeSearchInput: '', tradeSearchPlaceholder: 'Search trades',
    tradeTypeFilter: 'all', tradeTypeFilterOptions: [{ value: 'all', label: 'All types' }], tradeSortMode: 'newest',
    canOpenMyTradeTerminal: () => true, openMyTradeTerminal: vi.fn(), onRefreshMyTrades: vi.fn(), onSelectGroup: vi.fn(),
    currentPairLabel: 'BCN/HBR', pairScope: 'all', onPairScopeChange: vi.fn(), onClearFilters: vi.fn(), onSearchInputChange: vi.fn(),
    onClearSearch: vi.fn(), onToggleMobileFilters: vi.fn(), onTypeFilterChange: vi.fn(), onSortModeChange: vi.fn(), onCreateOffer: vi.fn(),
    renderAdditionalTrades: () => null, ...patch
  };
  return renderToStaticMarkup(createElement(TradeMyTradesSection, props));
};
const expectUnavailableCounts = (markup: string) => {
  expect(markup).toMatch(/aria-label="Active: (?:unavailable|—)"/);
  expect(markup).toMatch(/aria-label="History: (?:unavailable|—)"/);
  expect(markup).toContain('class="p2p-wallet-trade-count">—</strong>');
  expect(markup).not.toMatch(/<(?:strong|b)(?:\s[^>]*)?>[01]<\/(?:strong|b)>/);
};

describe('My trades readiness', () => {
  it.each([false, true])('does not report an empty %s history while private trades are locked', history => {
    const markup = render({ privateTradesLocked: true }, history);
    expect(markup).toContain('Private trades are locked. Unlock privacy in the header.');
    expect(markup).not.toContain('No active trades'); expect(markup).not.toContain('No trade history');
    expectUnavailableCounts(markup);
  });
  it('keeps known public offers visible while private totals are unavailable', () => {
    const markup = render({ privateTradesLocked: true }, false, true);
    expect(markup).toContain('Known public offer #7');
    expect(markup).toContain('Private trades are locked. Unlock privacy in the header.');
    expectUnavailableCounts(markup);
  });
  it('keeps the ordinary unlocked empty state and zero counts', () => {
    const markup = render();
    expect(markup).toContain('No active trades'); expect(markup).toContain('aria-label="Active: 0"');
    expect(markup).not.toContain('Private trades are locked');
  });
  it('shows loading instead of an empty result while readers start', () => {
    const markup = render({ loadingMyTrades: true });
    expect(markup).toContain('Loading your trades'); expect(markup).not.toContain('No active trades');
    expectUnavailableCounts(markup);
  });
  it('keeps verified rows usable while older activity loads without claiming complete totals', () => {
    const markup = render({ loadingMyTrades: true }, false, true);
    expect(markup).toContain('Known public offer #7');
    expect(markup).toContain('Refreshing...');
    expect(markup).not.toContain('No active trades');
    expectUnavailableCounts(markup);
  });
  it('shows unavailable counts instead of an empty result after a failed read', () => {
    const markup = render({ myTradesError: 'Reader unavailable' });
    expect(markup).toContain('Some trades could not load'); expect(markup).not.toContain('No active trades');
    expectUnavailableCounts(markup);
  });
});
