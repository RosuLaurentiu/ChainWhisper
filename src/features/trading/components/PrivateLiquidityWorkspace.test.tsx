import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PrivateLiquidityWorkspace from './PrivateLiquidityWorkspace';

const renderView = (activeView: 'discover' | 'mine' | 'create' | 'intents', deploymentReady = false) =>
  renderToStaticMarkup(createElement(PrivateLiquidityWorkspace, {
    activeView,
    deploymentReady,
    walletReady: false,
    onBackToSwap: () => undefined,
    onChangeView: () => undefined
  }));

describe('PrivateLiquidityWorkspace', () => {
  it('keeps positions and hidden intents in one dedicated NFT workspace', () => {
    const markup = renderView('discover');
    expect(markup).toContain('Legacy Position NFT workspace');
    expect(markup).toContain('Discover');
    expect(markup).toContain('My positions');
    expect(markup).toContain('Create');
    expect(markup).toContain('Hidden limit intents');
    expect(markup).toContain('Best bid');
    expect(markup).toContain('Reviewed deployment required');
  });

  it('explains and disables the two-packed-input Hidden Intent flow before V2 activation', () => {
    const markup = renderView('intents');
    expect(markup).toContain('Private recurring limit orders');
    expect(markup).toContain('Amount to sell');
    expect(markup).toContain('Limit price');
    expect(markup).toContain('Advanced settings');
    expect(markup).toContain('Two packed COTI confirmations');
    expect(markup).toContain('Private Liquidity V2 deployment pending');
    expect(markup).toContain('disabled=""');
  });

  it('renders decrypted owner-only hidden intent terms, execution amounts, and management actions', () => {
    const address = (pair: string) => `0x${pair.repeat(20)}`;
    const baseToken = address('44');
    const quoteToken = address('55');
    const markup = renderToStaticMarkup(createElement(PrivateLiquidityWorkspace, {
      activeView: 'intents',
      deploymentReady: true,
      walletReady: true,
      positionTokens: [
        { address: baseToken, decimals: 1, selection: 'base', symbol: 'p.BASE' },
        { address: quoteToken, decimals: 1, selection: 'quote', symbol: 'p.QUOTE' }
      ],
      hiddenIntentOwnerDataStatus: 'available',
      hiddenIntentOwnerPage: {
        totalCount: '1',
        nextOffset: '0',
        atBlock: { number: '140', hash: `0x${'aa'.repeat(32)}` },
        items: [{
          view: {
            intentId: '7',
            status: 'open',
            owner: address('22'),
            baseToken,
            quoteToken,
            pairKey: `0x${'33'.repeat(32)}`,
            createdAt: '100',
            expiresAt: '9999999999',
            cooldownBlocks: '10',
            fillCount: '2',
            lastActivityBlock: '139',
            lastFillBlock: '138',
            hasPrivateTerms: true
          },
          receipt: {
            intentId: '7',
            recipient: address('22'),
            sequence: '3',
            side: 'sell-base',
            limitTerms: { baseAmount: '10', quoteAmount: '120' },
            remainingBudget: '500',
            minimumFill: '100',
            lastInputAmount: '20',
            lastOutputAmount: '240'
          }
        }]
      },
      onBackToSwap: () => undefined,
      onChangeView: () => undefined,
      onCreateHiddenIntent: () => undefined,
      onCancelHiddenIntent: () => undefined,
      onReclaimHiddenIntent: () => undefined,
      onRevealHiddenIntentOwnerData: () => undefined
    }));
    expect(markup).toContain('Hidden intent #7');
    expect(markup).toContain('Sell base for quote');
    expect(markup).toContain('1 p.BASE for 12 p.QUOTE');
    expect(markup).toContain('50 p.BASE');
    expect(markup).toContain('10 p.BASE');
    expect(markup).toContain('2 p.BASE -&gt; 24 p.QUOTE');
    expect(markup).toContain('2 fills');
    expect(markup).toContain('Cancel and refund');
  });

  it('enables only pair-level settlement for a complete active market route', () => {
    const address = (pair: string) => `0x${pair.repeat(20)}`;
    const baseToken = address('44');
    const quoteToken = address('55');
    const markup = renderToStaticMarkup(createElement(PrivateLiquidityWorkspace, {
      activeView: 'intents',
      deploymentReady: true,
      walletReady: true,
      model: {
        atBlock: { number: '140', hash: `0x${'aa'.repeat(32)}` },
        positions: [],
        ownedPositions: [],
        selection: { status: 'none', historyRows: [] },
        markets: [{
          pairKey: `0x${'33'.repeat(32)}`,
          baseToken,
          quoteToken,
          activePositionCount: 3,
          crossed: false
        }]
      },
      positionTokens: [
        { address: baseToken, decimals: 6, selection: 'base', symbol: 'p.BASE' },
        { address: quoteToken, decimals: 6, selection: 'quote', symbol: 'p.QUOTE' }
      ],
      onBackToSwap: () => undefined,
      onChangeView: () => undefined,
      onCreateHiddenIntent: () => undefined,
      onSettleHiddenIntents: () => undefined
    }));
    expect(markup).toContain('The contract chooses up to four queued intents');
    expect(markup).toContain('3 active positions in the complete p.BASE/p.QUOTE route.');
    expect(markup).toContain('class="standalone-trade-secondary-btn">Settle ready intents</button>');
    expect(markup).not.toContain('intent ID is exposed');
  });

  it('shows the packed private-input creation model and fails closed before deployment', () => {
    const markup = renderView('create');
    expect(markup).toContain('Starting price and spread');
    expect(markup).toContain('Balanced encrypted inventory');
    expect(markup).toContain('matching side is calculated for you');
    expect(markup).toContain('Both deposits are packed into one COTI private input');
    expect(markup).toContain('Private liquidity deployment pending');
    expect(markup).toContain('disabled=""');
  });

  it('composes the owner manager inside My positions without activating it globally', () => {
    const address = (pair: string) => `0x${pair.repeat(20)}`;
    const position = {
      identity: { chainId: '7082400', contractAddress: address('11'), positionId: '7' },
      owner: address('22'),
      pairKey: `0x${'33'.repeat(32)}`,
      baseToken: address('44'),
      quoteToken: address('55'),
      buyTerms: { baseAmount: '10', quoteAmount: '90' },
      sellTerms: { baseAmount: '10', quoteAmount: '110' },
      status: 'active' as const,
      revision: '4',
      buySideAvailable: true,
      sellSideAvailable: true,
      privacyOwner: address('22'),
      createdAt: '100',
      lastActivityBlock: '120'
    };
    const markup = renderToStaticMarkup(createElement(PrivateLiquidityWorkspace, {
      activeView: 'mine',
      deploymentReady: true,
      walletReady: true,
      model: {
        atBlock: { number: '130', hash: `0x${'aa'.repeat(32)}` },
        positions: [position],
        markets: [],
        ownedPositions: [position],
        selection: { status: 'manageable', position, historyRows: [] }
      },
      positionTokens: [
        { address: position.baseToken, decimals: 1, selection: 'base', symbol: 'p.BASE' },
        { address: position.quoteToken, decimals: 1, selection: 'quote', symbol: 'p.QUOTE' }
      ],
      managedPositionInventory: { state: 'locked' },
      ownerPrivateDataStatus: 'available',
      ownerPrivateHistory: {
        traderRows: [{
          kind: 'private-liquidity-swap',
          key: 'swap-12',
          swapId: '12',
          direction: 'base-to-quote',
          pairKey: position.pairKey,
          inputAmount: '30',
          outputAmount: '330',
          unusedInputAmount: '10',
          candidateCount: 4,
          provenance: {
            chainId: '7082400',
            contractAddress: position.identity.contractAddress,
            blockNumber: '129',
            blockHash: `0x${'bb'.repeat(32)}`,
            transactionHash: `0x${'cc'.repeat(32)}`,
            transactionIndex: 1,
            logIndex: 2
          }
        }],
        positionRows: [],
        positionTotals: []
      },
      onBackToSwap: () => undefined,
      onBackToPositions: () => undefined,
      onChangeView: () => undefined,
      onPositionAction: () => undefined
    }));
    expect(markup).toContain('Manage Position NFT 7');
    expect(markup).toContain('Edit prices');
    expect(markup).toContain('Transfer NFT');
    expect(markup).toContain('My private swap activity');
    expect(markup).toContain('Swap #12');
    expect(markup).toContain('Spent 3 p.BASE');
    expect(markup).toContain('Received 33 p.QUOTE');
    expect(markup).toContain('Returned 1 p.BASE');
    expect(markup).toContain('4 positions checked');
    expect(markup).not.toContain('No owned Position NFTs found');
  });

  it('reports bounded canonical hydration progress without claiming an empty market', () => {
    const markup = renderToStaticMarkup(createElement(PrivateLiquidityWorkspace, {
      activeView: 'discover',
      deploymentReady: true,
      walletReady: false,
      loading: true,
      hydratedPositionCount: 128,
      totalPositionCount: '260',
      onBackToSwap: () => undefined,
      onChangeView: () => undefined
    }));
    expect(markup).toContain('Loading finalized Position NFTs');
    expect(markup).toContain('128 of 260 positions verified at one canonical block.');
    expect(markup).toContain('Position markets are loading');
    expect(markup).not.toContain('No indexed position markets yet');
  });

  it('offers a prompt-free deployment retry when a public RPC check fails', () => {
    const markup = renderToStaticMarkup(createElement(PrivateLiquidityWorkspace, {
      activeView: 'discover',
      deploymentReady: false,
      walletReady: false,
      routeError: 'Private Liquidity V2 RPC eth_getCode failed.',
      onBackToSwap: () => undefined,
      onChangeView: () => undefined,
      onRefresh: () => undefined
    }));
    expect(markup).toContain('Private Liquidity V2 RPC eth_getCode failed.');
    expect(markup).toContain('Retry deployment check');
    expect(markup).not.toContain('Refresh finalized positions');
  });

  it('keeps the optional daily marginal chart lazy-loaded', () => {
    const withoutStore = renderView('discover', true);
    expect(withoutStore).not.toContain('Loading daily price chart');
    const withStore = renderToStaticMarkup(createElement(PrivateLiquidityWorkspace, {
      activeView: 'discover',
      deploymentReady: true,
      walletReady: false,
      dailyPriceChart: {
        pairLabel: 'p.COTI / p.USDC',
        quoteSymbol: 'p.USDC',
        points: []
      },
      onBackToSwap: () => undefined,
      onChangeView: () => undefined
    }));
    expect(withStore).toContain('Loading daily price chart');
  });

  it('lets one market select the daily-price chart without exposing private depth', () => {
    const pairKey = `0x${'33'.repeat(32)}`;
    const markup = renderToStaticMarkup(createElement(PrivateLiquidityWorkspace, {
      activeView: 'discover',
      deploymentReady: true,
      walletReady: false,
      selectedDailyPricePairKey: pairKey,
      onSelectDailyPricePair: () => undefined,
      model: {
        atBlock: { number: '140', hash: `0x${'aa'.repeat(32)}` },
        positions: [],
        ownedPositions: [],
        selection: { status: 'none', historyRows: [] },
        markets: [{
          pairKey,
          baseToken: `0x${'44'.repeat(20)}`,
          quoteToken: `0x${'55'.repeat(20)}`,
          activePositionCount: 2,
          crossed: false
        }]
      },
      onBackToSwap: () => undefined,
      onChangeView: () => undefined
    }));
    expect(markup).toContain('class="is-price-selected"');
    expect(markup).toContain('class="p2p-private-liquidity-market-pair"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).not.toContain('Trading volume');
    expect(markup).not.toContain('Liquidity depth');
  });
});
