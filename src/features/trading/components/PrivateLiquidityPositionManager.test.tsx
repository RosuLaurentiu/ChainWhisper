import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PrivateLiquidityPosition } from '../../../lib/privateLiquidity';
import type {
  PrivateLiquidityPositionHistoryRow,
  PrivateLiquidityPositionHistoryTotals
} from '../../../lib/privateLiquidityHistory';
import type { PrivateLiquidityPositionToken } from '../../../lib/privateLiquidityPositionFlow';
import PrivateLiquidityPositionManager from './PrivateLiquidityPositionManager';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;

const position = (privacyOwner: string | null = address('22')): PrivateLiquidityPosition => ({
  identity: { chainId: '7082400', contractAddress: address('11'), positionId: '7' },
  owner: address('22'),
  pairKey: hash('33'),
  baseToken: address('44'),
  quoteToken: address('55'),
  buyTerms: { baseAmount: '10', quoteAmount: '90' },
  sellTerms: { baseAmount: '10', quoteAmount: '110' },
  status: 'paused',
  revision: '4',
  buySideAvailable: true,
  sellSideAvailable: false,
  privacyOwner,
  createdAt: '100',
  lastActivityBlock: '120'
});

const row: PrivateLiquidityPositionHistoryRow = {
  kind: 'private-liquidity-position-fill',
  key: 'fill-1',
  positionKey: 'position-7',
  positionId: '7',
  swapId: '9',
  direction: 'quote-to-base',
  baseAmount: '3',
  quoteAmount: '33',
  provenance: {
    chainId: '7082400',
    contractAddress: address('11'),
    blockNumber: '121',
    blockHash: hash('66'),
    transactionHash: hash('77'),
    transactionIndex: 1,
    logIndex: 2
  }
};

const totals: PrivateLiquidityPositionHistoryTotals = {
  positionKey: 'position-7',
  positionId: '7',
  fillCount: 1,
  baseReceived: '0',
  basePaid: '3',
  quoteReceived: '33',
  quotePaid: '0'
};

const baseToken: PrivateLiquidityPositionToken = {
  address: position().baseToken,
  decimals: 1,
  selection: 'base',
  symbol: 'p.BASE'
};

const quoteToken: PrivateLiquidityPositionToken = {
  address: position().quoteToken,
  decimals: 1,
  selection: 'quote',
  symbol: 'p.QUOTE'
};

const renderManager = (
  privacyOwner: string | null = address('22'),
  inventory: Parameters<typeof PrivateLiquidityPositionManager>[0]['inventory'] = {
    state: 'available',
    baseAmount: '2',
    quoteAmount: '20'
  }
) => renderToStaticMarkup(createElement(
  PrivateLiquidityPositionManager,
  {
    position: position(privacyOwner),
    baseToken,
    quoteToken,
    inventory,
    totals,
    historyRows: [row],
    deploymentReady: true,
    walletReady: true,
    onAction: () => undefined,
    onBack: () => undefined
  }
));

describe('PrivateLiquidityPositionManager', () => {
  it('shows the full owner lifecycle and exact per-position trading history', () => {
    const markup = renderManager();
    expect(markup).toContain('Position NFT #7');
    expect(markup).toContain('Edit prices');
    expect(markup).toContain('Add liquidity');
    expect(markup).toContain('Withdraw liquidity');
    expect(markup).toContain('Resume');
    expect(markup).toContain('Transfer NFT');
    expect(markup).toContain('Close &amp; withdraw all');
    expect(markup).toContain('Swap #9');
    expect(markup).toContain('1 p.BASE / 9 p.QUOTE');
    expect(markup).toContain('0.3 p.BASE');
    expect(markup).toContain('3.3 p.QUOTE');
    expect(markup).toContain('p.BASE received 0');
    expect(markup).toContain('2 p.BASE');
    expect(markup).toContain('20 p.QUOTE');
  });

  it('blocks normal mutations until the transferred NFT owner activates privacy', () => {
    const markup = renderManager(null);
    expect(markup).toContain('Privacy activation required after transfer');
    expect(markup).toContain('Activate privacy');
    expect(markup).toMatch(/<button type="button" disabled="">Edit prices<\/button>/);
    expect(markup).toMatch(/<button type="button">Transfer NFT<\/button>/);
  });

  it('keeps wallet-private inventory and fill history behind an explicit reveal action', () => {
    const markup = renderToStaticMarkup(createElement(PrivateLiquidityPositionManager, {
      position: position(),
      baseToken,
      quoteToken,
      inventory: { state: 'locked' },
      historyRows: [],
      deploymentReady: true,
      walletReady: true,
      onRevealPrivateData: () => undefined,
      onAction: () => undefined,
      onBack: () => undefined
    }));
    expect(markup).toContain('Unlock COTI privacy to reveal current inventory');
    expect(markup).toContain('Reveal private data');
    expect(markup).not.toContain('Swap #9');
  });
});
