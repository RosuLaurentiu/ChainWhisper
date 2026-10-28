import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TradeTokenPresetKey } from '../../../lib/appHelpers';
import type { PrivateLiquiditySwapQuote } from '../../../lib/privateLiquidityQuote';
import PrivateLiquiditySwapPanel from './PrivateLiquiditySwapPanel';

const quote: PrivateLiquiditySwapQuote = {
  direction: 'base-to-quote',
  pairKey: `0x${'11'.repeat(32)}`,
  maximumInput: '100',
  minimumInputFilled: '0',
  minimumFillBps: 0,
  bestFullFillOutput: '101',
  limitFullFillOutput: '98',
  slippageBps: 500,
  bestTerms: { baseAmount: '1', quoteAmount: '101' },
  limitTerms: { baseAmount: '1', quoteAmount: '99' },
  candidates: [1, 2, 3].map((positionId) => ({
    key: `private-liquidity-v1:2632500:0x${'22'.repeat(20)}:${positionId}`,
    positionId: String(positionId),
    expectedRevision: '4',
    terms: { baseAmount: '1', quoteAmount: String(102 - positionId) },
    owner: `0x${'33'.repeat(20)}`
  })),
  selectedCandidateCount: 3,
  candidateSetComplete: true,
  omittedPositionCount: 0,
  exactCapacityKnown: false,
  executionPolicy: 'partial-fill-to-price-limit',
  unusedInputStaysInWallet: true,
  packedSwapValue: '1'
};

const props = (overrides: Partial<Parameters<typeof PrivateLiquiditySwapPanel>[0]> = {}) => ({
  tradeEntryModeTabs: createElement('div', null, 'Trade modes'),
  venueTabs: createElement('div', null, 'Venue modes'),
  sellAmountInput: '100',
  sellBalanceLabel: 'Balance 500 pWISP',
  sellBalanceTitle: 'Private balance',
  sellTokenSelection: 'pWISP' as TradeTokenPresetKey,
  buyTokenSelection: 'pCOTI' as TradeTokenPresetKey,
  tokenOptions: [
    { value: 'pWISP', label: 'pWISP', kindLabel: 'Private' as const },
    { value: 'pCOTI', label: 'pCOTI', kindLabel: 'Private' as const }
  ],
  quote,
  inputTokenDecimals: 0,
  inputTokenSymbol: 'p.WISP',
  outputTokenDecimals: 0,
  outputTokenSymbol: 'p.COTI',
  slippageBps: 500,
  minimumFillBps: 0,
  deploymentReady: true,
  walletReady: true,
  onSellAmountInputChange: () => undefined,
  onTokenSelectionChange: () => undefined,
  onFlipTokens: () => undefined,
  onOpenPools: () => undefined,
  onSlippageBpsChange: () => undefined,
  onMinimumFillBpsChange: () => undefined,
  onReview: () => undefined,
  ...overrides
});

describe('PrivateLiquiditySwapPanel', () => {
  it('shows a simple best price, full-fill range, and advanced partial-fill policy before review', () => {
    const markup = renderToStaticMarkup(createElement(PrivateLiquiditySwapPanel, props()));
    expect(markup).toContain('Recurring swaps across fixed-price NFT strategies');
    expect(markup).toContain('Executable liquidity available');
    expect(markup).toContain('p2p-liquidity-availability is-available');
    expect(markup).toContain('does not continuously move its own price');
    expect(markup).toContain('Receive if fully filled');
    expect(markup).toContain('Best available price');
    expect(markup).toContain('1 p.WISP ≈ 101 p.COTI');
    expect(markup).toContain('Maximum price movement');
    expect(markup).toContain('Worst included price: 1 p.WISP ≈ 99 p.COTI');
    expect(markup).toContain('Advanced execution protection');
    expect(markup).toContain('98–101 p.COTI');
    expect(markup).toContain('Minimum fill');
    expect(markup).toContain('Allow any partial fill');
    expect(markup).toContain('At least 25% of maximum spend');
    expect(markup).toContain('At least 50% of maximum spend');
    expect(markup).toContain('100% of maximum spend or revert');
    expect(markup).toContain('spends only what can execute within your price limit');
    expect(markup).toContain('3 Position NFTs');
    expect(markup).toContain('Best price to your limit');
    expect(markup).toContain('unused input stays in your wallet');
    expect(markup).toContain('filled amount is not known before execution');
    expect(markup).toContain('Review private swap');
  });

  it('renders exact encrypted-receipt trade history and an explicit unlock state', () => {
    const historyMarkup = renderToStaticMarkup(createElement(PrivateLiquiditySwapPanel, props({
      historyStatus: 'available',
      historyRows: [{
        key: 'swap-7',
        swapId: '7',
        pairLabel: 'p.WISP / p.COTI',
        inputLabel: '10 p.WISP',
        outputLabel: '9.9 p.COTI',
        unusedInputLabel: '2 p.WISP',
        blockNumber: '9045000',
        transactionHash: `0x${'44'.repeat(32)}`,
        status: 'finalized'
      }]
    })));
    expect(historyMarkup).toContain('Trade history');
    expect(historyMarkup).toContain('10 p.WISP');
    expect(historyMarkup).toContain('9.9 p.COTI');
    expect(historyMarkup).toContain('Unused: 2 p.WISP');
    expect(historyMarkup).toContain('Finalized');

    const lockedMarkup = renderToStaticMarkup(createElement(PrivateLiquiditySwapPanel, props({
      historyStatus: 'locked',
      onRevealHistory: () => undefined
    })));
    expect(lockedMarkup).toContain('Unlock history');
    expect(lockedMarkup).toContain('encrypted on-chain receipts');
  });

  it('accepts a custom slippage percentage and keeps failed submitted swaps in history', () => {
    const markup = renderToStaticMarkup(createElement(PrivateLiquiditySwapPanel, props({
      slippageBps: 237,
      historyRows: [{
        key: 'failed-swap',
        pairLabel: 'p.WISP / p.COTI',
        inputLabel: 'Attempted 10 p.WISP',
        outputLabel: 'No fill',
        unusedInputLabel: 'No tokens spent',
        transactionHash: `0x${'55'.repeat(32)}`,
        status: 'failed',
        failureMessage: 'The minimum fill was not available.',
        attemptedAt: 1
      }]
    })));
    expect(markup).toContain('value="2.37"');
    expect(markup).toContain('Custom maximum price movement percentage');
    expect(markup).toContain('Attempted 10 p.WISP');
    expect(markup).toContain('No fill');
    expect(markup).toContain('Failed');
    expect(markup).toContain('The minimum fill was not available.');
  });

  it('discloses omitted public positions without claiming a global-best route', () => {
    const markup = renderToStaticMarkup(createElement(PrivateLiquiditySwapPanel, props({
      quote: {
        ...quote,
        candidateSetComplete: false,
        omittedPositionCount: 2
      }
    })));
    expect(markup).toContain('2 additional public positions');
    expect(markup).toContain('not a global-best claim');
  });

  it('fails closed in the UI until a reviewed deployment is activated', () => {
    const markup = renderToStaticMarkup(createElement(PrivateLiquiditySwapPanel, props({
      quote: null,
      deploymentReady: false
    })));
    expect(markup).toContain('Private liquidity deployment pending');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('No executable position at this price limit');
  });

  it('distinguishes finalized-liquidity refresh from an empty route', () => {
    const markup = renderToStaticMarkup(createElement(PrivateLiquiditySwapPanel, props({
      quote: null,
      liquidityLoading: true
    })));
    expect(markup).toContain('Refreshing finalized position prices');
    expect(markup).toContain('Loading finalized liquidity');
    expect(markup).toContain('Checking finalized liquidity');
    expect(markup).not.toContain('No executable private quote');
  });

  it('keeps deployment failures visible and offers an explicit retry', () => {
    const markup = renderToStaticMarkup(createElement(PrivateLiquiditySwapPanel, props({
      quote: null,
      deploymentReady: false,
      deploymentError: 'Private Liquidity V2 RPC eth_getCode failed.',
      onRetryDeployment: () => undefined
    })));
    expect(markup).toContain('Private liquidity unavailable');
    expect(markup).toContain('Liquidity verification failed');
    expect(markup).toContain('Private Liquidity V2 RPC eth_getCode failed.');
    expect(markup).toContain('Retry deployment check');
    expect(markup).not.toContain('Private liquidity deployment pending');
    expect(markup).toContain('role="alert"');
  });

  it('shows quote failures and disables duplicate review while the wallet flow is active', () => {
    const unavailable = renderToStaticMarkup(createElement(PrivateLiquiditySwapPanel, props({
      quote: null,
      quoteError: 'No active NFT liquidity position quotes this private-token pair.'
    })));
    expect(unavailable).toContain('Quote unavailable');
    expect(unavailable).toContain('No active NFT liquidity position');

    const pending = renderToStaticMarkup(createElement(PrivateLiquiditySwapPanel, props({
      busy: true,
      actionMessage: 'Waiting for the private swap receipt…',
      actionStatus: 'pending'
    })));
    expect(pending).toContain('Private swap in progress…');
    expect(pending).toContain('Waiting for the private swap receipt…');
    expect(pending).toContain('disabled=""');
  });
});
