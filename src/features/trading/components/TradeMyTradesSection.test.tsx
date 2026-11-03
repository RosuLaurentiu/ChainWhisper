import { createElement, isValidElement, type ComponentProps, type ReactNode, type EffectCallback, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TradeSnapshot } from '../../../lib/appShared';
import TradeMyTradesSection, { type MyTradeGroupOption } from './TradeMyTradesSection';

const hooks = vi.hoisted(() => ({ enabled: false, index: 0, refs: [] as { current: unknown }[], effects: [] as EffectCallback[] }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  return { ...actual,
    useState: (initial: unknown) => hooks.enabled ? [initial, vi.fn()] : actual.useState(initial),
    useMemo: (compute: () => unknown, deps: unknown[]) => hooks.enabled ? compute() : actual.useMemo(compute, deps),
    useRef: (initial: unknown) => hooks.enabled ? hooks.refs[hooks.index++] ?? (hooks.refs[hooks.index - 1] = { current: initial }) : actual.useRef(initial),
    useEffect: (effect: EffectCallback, deps: unknown[]) => hooks.enabled ? hooks.effects.push(effect) : actual.useEffect(effect, deps)
  };
});
afterEach(() => { hooks.enabled = false; hooks.index = 0; hooks.refs = []; hooks.effects = []; vi.unstubAllGlobals(); });

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
const propsFor = (patch: Partial<Props> = {}, history = false, knownPublic = false): Props => {
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
  return props;
};
const render = (patch: Partial<Props> = {}, history = false, knownPublic = false): string =>
  renderToStaticMarkup(createElement(TradeMyTradesSection, propsFor(patch, history, knownPublic)));
const findButton = (node: ReactNode, label: string): ReactElement<{ onClick: () => void; disabled: boolean }> | undefined => {
  if (Array.isArray(node)) return node.map(child => findButton(child, label)).find(Boolean);
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void; disabled?: boolean }>(node)) return undefined;
  if (node.type === 'button' && node.props.children === label) return node as ReactElement<{ onClick: () => void; disabled: boolean }>;
  return findButton(node.props.children, label);
};
const expectUnavailableCounts = (markup: string) => {
  expect(markup).toMatch(/aria-label="Active: (?:unavailable|—)"/);
  expect(markup).toMatch(/aria-label="History: (?:unavailable|—)"/);
  expect(markup).toContain('class="p2p-wallet-trade-count">—</strong>');
  expect(markup).not.toMatch(/<(?:strong|b)(?:\s[^>]*)?>[01]<\/(?:strong|b)>/);
};

describe('My trades readiness', () => {
  it('marks recent history incomplete and keeps an accessible older control without an empty-history claim', () => {
    const markup = render({ historyHasMore: true, onLoadOlderHistory: vi.fn() }, true);
    expect(markup).toContain('Recent history loaded. Older trades are not loaded.');
    expect(markup).toContain('type="button">Load older history</button>');
    expect(markup).not.toContain('No trade history'); expect(markup).not.toContain('Book and Direct history is complete.');
  });
  it('shows complete history only after a complete read and keeps an explicit retry after an older error', () => {
    expect(render({ historyComplete: true, onLoadOlderHistory: vi.fn() }, true)).toContain('Book and Direct history is complete.');
    const markup = render({ historyHasMore: true, historyError: 'Older page unavailable', onLoadOlderHistory: vi.fn() }, true);
    expect(markup).toContain('History is incomplete. Verified trades remain available.');
    expect(markup).toContain('Retry older history'); expect(markup).toContain('Older page unavailable');
    expect(markup).not.toContain('Book and Direct history is complete.');
  });
  it('loads one page on scroll or button, stops automatic retries, and blocks stale locked controls', () => {
    hooks.enabled = true;
    vi.stubGlobal('window', { innerHeight: 800, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const load = vi.fn(), props = propsFor({ historyHasMore: true, onLoadOlderHistory: load }, true);
    const tree = () => { hooks.index = 0; hooks.effects = []; return TradeMyTradesSection(props); };
    tree(); let top = 1100;
    hooks.refs[0].current = { getBoundingClientRect: () => ({ top, bottom: top + 30 }) };
    hooks.effects.forEach(effect => effect());
    const scroll = vi.mocked(window.addEventListener).mock.calls[0][1] as () => void;
    expect(load).not.toHaveBeenCalled(); scroll(); expect(load).not.toHaveBeenCalled();
    top = 820; scroll(); scroll(); expect(load).toHaveBeenCalledTimes(1);
    props.historyLoading = true; tree(); hooks.effects[0](); scroll(); expect(load).toHaveBeenCalledTimes(1);
    props.historyLoading = false; props.historyError = 'Older page unavailable';
    const failed = tree(); hooks.effects[0](); scroll(); expect(load).toHaveBeenCalledTimes(1);
    const retry = findButton(failed, 'Retry older history')!;
    retry.props.onClick(); retry.props.onClick(); expect(load).toHaveBeenCalledTimes(2);
    props.privateTradesLocked = true; tree(); hooks.effects[0](); retry.props.onClick(); scroll();
    expect(load).toHaveBeenCalledTimes(2);
  });
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
  it.each([false, true])('shows pending setup instead of a blank panel before shared readers mount, history=%s', history => {
    const markup = render({ additionalPending: true, renderAdditionalTrades: undefined }, history);
    expect(markup).toContain('Loading your trades');
    expect(markup).toContain('Refreshing...');
    expect(markup).not.toContain('No active trades');
    expect(markup).not.toContain('No trade history');
    expectUnavailableCounts(markup);
  });
  it('keeps verified rows usable while older activity loads without claiming complete totals', () => {
    const markup = render({ loadingMyTrades: true }, false, true);
    expect(markup).toContain('Known public offer #7');
    expect(markup).toContain('Refreshing...');
    expect(markup).not.toContain('No active trades');
    expectUnavailableCounts(markup);
  });
  it.each([false, true])('finishes Refresh with idle incomplete participant history without claiming full totals, history=%s', history => {
    const markup = render({ additionalPending: false, additionalIncomplete: true }, history, true);
    expect(markup).not.toContain('Refreshing...');
    expect(markup).toContain('>Refresh</button>');
    expect(markup).not.toContain('No active trades');
    expect(markup).not.toContain('No trade history');
    if (!history) expect(markup).toContain('Known public offer #7');
    expectUnavailableCounts(markup);
  });
  it('shows unavailable counts instead of an empty result after a failed read', () => {
    const markup = render({ myTradesError: 'Reader unavailable' });
    expect(markup).toContain('Some trades could not load'); expect(markup).not.toContain('No active trades');
    expectUnavailableCounts(markup);
  });
});
