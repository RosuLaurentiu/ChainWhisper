import { describe, expect, it, vi } from 'vitest';

vi.mock('./privateLiquidityChain', async (importOriginal) => ({
  ...await importOriginal<typeof import('./privateLiquidityChain')>(),
  assertCompleteCanonicalPrivateLiquidityPositionSnapshot: vi.fn()
}));

import {
  buildPrivateLiquidityPairKey,
  buildPrivateLiquidityPositionKey,
  type PrivateLiquidityPosition
} from './privateLiquidity';
import type { CompleteCanonicalPrivateLiquidityPositionSnapshot } from './privateLiquidityChain';
import type { PrivateLiquidityHistory } from './privateLiquidityHistory';
import { buildPrivateLiquidityWorkspaceModel } from './privateLiquidityWorkspaceModel';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;
const CHAIN_ID = '7082400';
const CONTRACT = address('11');
const OWNER = address('22');
const OTHER = address('33');
const BASE = address('44');
const QUOTE = address('55');
const PAIR = buildPrivateLiquidityPairKey(BASE, QUOTE);

const position = ({
  id,
  owner = OWNER,
  bid,
  ask,
  status = 'active'
}: {
  id: string;
  owner?: string;
  bid: string;
  ask: string;
  status?: PrivateLiquidityPosition['status'];
}): PrivateLiquidityPosition => ({
  identity: { chainId: CHAIN_ID, contractAddress: CONTRACT, positionId: id },
  owner,
  pairKey: PAIR,
  baseToken: BASE,
  quoteToken: QUOTE,
  buyTerms: { baseAmount: '10', quoteAmount: bid },
  sellTerms: { baseAmount: '10', quoteAmount: ask },
  status,
  revision: '4',
  buySideAvailable: true,
  sellSideAvailable: true,
  privacyOwner: owner,
  createdAt: '100',
  lastActivityBlock: '120'
});

const snapshot = (positions: readonly PrivateLiquidityPosition[]) => ({
  scope: { chainId: CHAIN_ID, contractAddress: CONTRACT, deploymentBlock: '100' },
  atBlock: { number: '130', hash: hash('aa') },
  positionCount: positions.length.toString(),
  positions
}) as unknown as CompleteCanonicalPrivateLiquidityPositionSnapshot;

const history = (selected: PrivateLiquidityPosition): PrivateLiquidityHistory => {
  const positionKey = buildPrivateLiquidityPositionKey(selected.identity);
  return {
    traderRows: [],
    positionRows: [{
      kind: 'private-liquidity-position-fill',
      key: 'fill-1',
      positionKey,
      positionId: selected.identity.positionId,
      swapId: '9',
      direction: 'quote-to-base',
      baseAmount: '3',
      quoteAmount: '33',
      provenance: {
        chainId: CHAIN_ID,
        contractAddress: CONTRACT,
        blockNumber: '121',
        blockHash: hash('bb'),
        transactionHash: hash('cc'),
        transactionIndex: 1,
        logIndex: 2
      }
    }],
    positionTotals: [{
      positionKey,
      positionId: selected.identity.positionId,
      fillCount: 1,
      baseReceived: '0',
      basePaid: '3',
      quoteReceived: '33',
      quotePaid: '0'
    }]
  };
};

describe('privateLiquidityWorkspaceModel', () => {
  it('projects best public prices, owned NFTs, and exact scoped management history', () => {
    const selected = position({ id: '1', bid: '90', ask: '120' });
    const model = buildPrivateLiquidityWorkspaceModel({
      snapshot: snapshot([
        selected,
        position({ id: '2', owner: OTHER, bid: '100', ask: '110' }),
        position({ id: '3', bid: '200', ask: '20', status: 'paused' })
      ]),
      walletAddress: OWNER,
      selectedPositionId: '1',
      history: history(selected)
    });

    expect(model.atBlock.number).toBe('130');
    expect(model.markets).toHaveLength(1);
    expect(model.markets[0]).toMatchObject({
      activePositionCount: 2,
      bestBid: { positionId: '2' },
      bestAsk: { positionId: '2' },
      crossed: false,
      spreadBps: '1000'
    });
    expect(model.ownedPositions.map((candidate) => candidate.identity.positionId)).toEqual(['1', '3']);
    expect(model.selection.status).toBe('manageable');
    expect(model.selection.historyRows).toHaveLength(1);
    expect(model.selection.totals?.quoteReceived).toBe('33');
  });

  it('keeps another owner read-only and never attaches participant history', () => {
    const selected = position({ id: '2', owner: OTHER, bid: '100', ask: '110' });
    const model = buildPrivateLiquidityWorkspaceModel({
      snapshot: snapshot([selected]),
      walletAddress: OWNER,
      selectedPositionId: '2',
      history: history(selected)
    });
    expect(model.selection.status).toBe('read-only');
    expect(model.selection.position?.identity.positionId).toBe('2');
    expect(model.selection.historyRows).toEqual([]);
  });

  it('fails closed on foreign history, missing positions, and invalid route ids', () => {
    const selected = position({ id: '1', bid: '90', ask: '120' });
    const validHistory = history(selected);
    const foreignHistory: PrivateLiquidityHistory = {
      ...validHistory,
      positionRows: [{
        ...validHistory.positionRows[0],
        provenance: { ...validHistory.positionRows[0].provenance, contractAddress: OTHER }
      }]
    };
    expect(() => buildPrivateLiquidityWorkspaceModel({
      snapshot: snapshot([selected]),
      walletAddress: OWNER,
      history: foreignHistory
    })).toThrow(/another deployment/);
    expect(buildPrivateLiquidityWorkspaceModel({
      snapshot: snapshot([selected]),
      walletAddress: OWNER,
      selectedPositionId: '9'
    }).selection.status).toBe('missing');
    expect(() => buildPrivateLiquidityWorkspaceModel({
      snapshot: snapshot([selected]),
      selectedPositionId: '0'
    })).toThrow(/must be positive/);
  });
});
