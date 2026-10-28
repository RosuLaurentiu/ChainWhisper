import {
  buildPrivateLiquidityPositionKey,
  normalizePrivateLiquidityAddress,
  parsePrivateLiquidityUint,
  validatePrivateLiquidityPosition,
  type PrivateLiquidityPosition,
  type PrivateLiquiditySideTerms
} from './privateLiquidity';
import {
  assertCompleteCanonicalPrivateLiquidityPositionSnapshot,
  type CompleteCanonicalPrivateLiquidityPositionSnapshot
} from './privateLiquidityChain';
import type {
  PrivateLiquidityHistory,
  PrivateLiquidityPositionHistoryRow,
  PrivateLiquidityPositionHistoryTotals
} from './privateLiquidityHistory';

export type PrivateLiquidityMarketSide = Readonly<{
  positionId: string;
  terms: PrivateLiquiditySideTerms;
}>;

export type PrivateLiquidityMarketRow = Readonly<{
  pairKey: string;
  baseToken: string;
  quoteToken: string;
  activePositionCount: number;
  bestBid?: PrivateLiquidityMarketSide;
  bestAsk?: PrivateLiquidityMarketSide;
  spreadBps?: string;
  crossed: boolean;
}>;

export type PrivateLiquidityPositionSelection = Readonly<{
  status: 'none' | 'missing' | 'wallet-required' | 'read-only' | 'manageable';
  position?: PrivateLiquidityPosition;
  historyRows: readonly PrivateLiquidityPositionHistoryRow[];
  totals?: PrivateLiquidityPositionHistoryTotals;
}>;

export type PrivateLiquidityWorkspaceModel = Readonly<{
  atBlock: Readonly<{ number: string; hash: string }>;
  /** Complete public position projection at the same canonical block as markets. */
  positions: readonly PrivateLiquidityPosition[];
  markets: readonly PrivateLiquidityMarketRow[];
  ownedPositions: readonly PrivateLiquidityPosition[];
  selection: PrivateLiquidityPositionSelection;
}>;

const comparePrice = (left: PrivateLiquiditySideTerms, right: PrivateLiquiditySideTerms): number => {
  const leftQuote = parsePrivateLiquidityUint(left.quoteAmount, 'Left quote terms');
  const leftBase = parsePrivateLiquidityUint(left.baseAmount, 'Left base terms');
  const rightQuote = parsePrivateLiquidityUint(right.quoteAmount, 'Right quote terms');
  const rightBase = parsePrivateLiquidityUint(right.baseAmount, 'Right base terms');
  const leftProduct = leftQuote * rightBase;
  const rightProduct = rightQuote * leftBase;
  return leftProduct < rightProduct ? -1 : leftProduct > rightProduct ? 1 : 0;
};

const normalizeRequestedPositionId = (value?: string | null): string | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = parsePrivateLiquidityUint(value, 'Selected private-liquidity position ID');
  if (parsed <= 0n) throw new Error('Selected private-liquidity position ID must be positive.');
  return parsed.toString();
};

const assertHistoryScope = ({
  history,
  snapshot
}: {
  history: PrivateLiquidityHistory;
  snapshot: CompleteCanonicalPrivateLiquidityPositionSnapshot;
}): void => {
  for (const row of history.positionRows) {
    if (
      row.provenance.chainId !== snapshot.scope.chainId ||
      normalizePrivateLiquidityAddress(row.provenance.contractAddress, 'History contract') !== snapshot.scope.contractAddress
    ) {
      throw new Error('Private-liquidity history belongs to another deployment.');
    }
  }
};

export const buildPrivateLiquidityWorkspaceModel = ({
  snapshot,
  walletAddress,
  selectedPositionId,
  history = Object.freeze({ traderRows: Object.freeze([]), positionRows: Object.freeze([]), positionTotals: Object.freeze([]) })
}: {
  snapshot: CompleteCanonicalPrivateLiquidityPositionSnapshot;
  walletAddress?: string | null;
  selectedPositionId?: string | null;
  history?: PrivateLiquidityHistory;
}): PrivateLiquidityWorkspaceModel => {
  assertCompleteCanonicalPrivateLiquidityPositionSnapshot(snapshot);
  assertHistoryScope({ history, snapshot });
  const owner = walletAddress
    ? normalizePrivateLiquidityAddress(walletAddress, 'Private-liquidity wallet')
    : null;
  const requestedPositionId = normalizeRequestedPositionId(selectedPositionId);
  const positions = snapshot.positions.map((position) => {
    validatePrivateLiquidityPosition(position);
    if (
      position.identity.chainId !== snapshot.scope.chainId ||
      position.identity.contractAddress !== snapshot.scope.contractAddress
    ) {
      throw new Error('Private-liquidity position belongs to another deployment.');
    }
    return position;
  });

  const marketMap = new Map<string, {
    pairKey: string;
    baseToken: string;
    quoteToken: string;
    activePositionCount: number;
    bestBid?: PrivateLiquidityMarketSide;
    bestAsk?: PrivateLiquidityMarketSide;
  }>();
  for (const position of positions) {
    let market = marketMap.get(position.pairKey);
    if (!market) {
      market = {
        pairKey: position.pairKey,
        baseToken: position.baseToken,
        quoteToken: position.quoteToken,
        activePositionCount: 0
      };
      marketMap.set(position.pairKey, market);
    } else if (market.baseToken !== position.baseToken || market.quoteToken !== position.quoteToken) {
      throw new Error('Private-liquidity pair key maps to inconsistent tokens.');
    }
    if (position.status !== 'active') continue;
    market.activePositionCount++;
    if (position.buySideAvailable && (
      !market.bestBid || comparePrice(position.buyTerms, market.bestBid.terms) > 0
    )) {
      market.bestBid = Object.freeze({ positionId: position.identity.positionId, terms: position.buyTerms });
    }
    if (position.sellSideAvailable && (
      !market.bestAsk || comparePrice(position.sellTerms, market.bestAsk.terms) < 0
    )) {
      market.bestAsk = Object.freeze({ positionId: position.identity.positionId, terms: position.sellTerms });
    }
  }

  const ownedPositions = owner
    ? positions.filter((position) => position.owner === owner)
    : [];
  let selection: PrivateLiquidityPositionSelection = Object.freeze({
    status: 'none',
    historyRows: Object.freeze([])
  });
  if (requestedPositionId) {
    const position = positions.find((candidate) => candidate.identity.positionId === requestedPositionId);
    if (!position) {
      selection = Object.freeze({ status: 'missing', historyRows: Object.freeze([]) });
    } else if (!owner) {
      selection = Object.freeze({ status: 'wallet-required', position, historyRows: Object.freeze([]) });
    } else if (position.owner !== owner) {
      selection = Object.freeze({ status: 'read-only', position, historyRows: Object.freeze([]) });
    } else {
      const positionKey = buildPrivateLiquidityPositionKey(position.identity);
      const historyRows = Object.freeze(history.positionRows.filter((row) => row.positionKey === positionKey));
      const totals = history.positionTotals.find((candidate) => candidate.positionKey === positionKey);
      selection = Object.freeze({
        status: 'manageable',
        position,
        historyRows,
        ...(totals ? { totals } : {})
      });
    }
  }

  return Object.freeze({
    atBlock: snapshot.atBlock,
    positions: Object.freeze(positions),
    markets: Object.freeze([...marketMap.values()].map((market) => {
      if (!market.bestBid || !market.bestAsk) {
        return Object.freeze({ ...market, crossed: false });
      }
      const bidQuote = parsePrivateLiquidityUint(market.bestBid.terms.quoteAmount, 'Best bid quote');
      const bidBase = parsePrivateLiquidityUint(market.bestBid.terms.baseAmount, 'Best bid base');
      const askQuote = parsePrivateLiquidityUint(market.bestAsk.terms.quoteAmount, 'Best ask quote');
      const askBase = parsePrivateLiquidityUint(market.bestAsk.terms.baseAmount, 'Best ask base');
      const askProduct = askQuote * bidBase;
      const bidProduct = bidQuote * askBase;
      return askProduct < bidProduct
        ? Object.freeze({ ...market, crossed: true })
        : Object.freeze({
            ...market,
            crossed: false,
            spreadBps: (((askProduct - bidProduct) * 10_000n) / bidProduct).toString()
          });
    })),
    ownedPositions: Object.freeze(ownedPositions),
    selection
  });
};
