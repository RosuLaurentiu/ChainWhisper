import { describe, expect, it, vi } from 'vitest';
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useCallback: <T,>(fn: T) => fn, useEffect: () => {} }));
import createP2PTradeEntryNavigation from './useP2PTradeEntryNavigation';

const fixture = (hasTradeDraft: boolean) => {
  const args = {
    navigateDeskView: vi.fn(), routeView: 'swap' as const, hasTradeDraft, onPrefillMarketPair: vi.fn(),
    isEntryBlocked: vi.fn(() => false),
    setTradeActionError: vi.fn(), setTradeCreateMode: vi.fn(),
    setTradeOfferCustomTokenAddress: vi.fn(), setTradeOfferTokenSelection: vi.fn(),
    setTradeRequestCustomTokenAddress: vi.fn(), setTradeRequestTokenSelection: vi.fn(),
    startFreshOneOffTrade: vi.fn(), swapActionMode: 'buy' as const,
    swapBuyTokenSelection: 'base', swapSellTokenSelection: 'quote'
  };
  return { args, navigation: createP2PTradeEntryNavigation(args) };
};

describe('P2P Create tab navigation', () => {
  it('prefills an empty offer with the selected market pair', () => {
    const { args, navigation } = fixture(false);
    navigation.navigateTradeView('/otc/limit');
    expect(args.setTradeOfferTokenSelection).toHaveBeenCalledWith('quote');
    expect(args.setTradeRequestTokenSelection).toHaveBeenCalledWith('base');
    expect(args.navigateDeskView).toHaveBeenCalledWith('/otc/limit');
    expect(args.startFreshOneOffTrade).not.toHaveBeenCalled();
  });
  it('preserves an existing draft', () => {
    const { args, navigation } = fixture(true);
    navigation.navigateTradeView('/otc/limit');
    expect(args.setTradeOfferTokenSelection).not.toHaveBeenCalled();
    expect(args.setTradeRequestTokenSelection).not.toHaveBeenCalled();
    expect(args.navigateDeskView).toHaveBeenCalledWith('/otc/limit');
  });
  it('holds every Create entry if a wallet request starts after render', () => {
    const { args, navigation } = fixture(false);
    args.isEntryBlocked.mockReturnValue(true);
    navigation.navigateTradeView('/otc/limit');
    navigation.openLimitOrderFromSwapPair();
    navigation.openTradeEntryMode('limit');
    expect(args.navigateDeskView).not.toHaveBeenCalled();
    expect(args.startFreshOneOffTrade).not.toHaveBeenCalled();
    expect(args.setTradeOfferTokenSelection).not.toHaveBeenCalled();
    expect(args.setTradeRequestTokenSelection).not.toHaveBeenCalled();
    expect(args.onPrefillMarketPair).not.toHaveBeenCalled();
  });
});
