import {
  assertAttestedPrivateLiquidityDeployment,
  assertCanonicalPrivateLiquidityCatalogAnchor,
  assertCanonicalPrivateLiquidityLogRange,
  type AttestedPrivateLiquidityDeployment,
  type CanonicalPrivateLiquidityCatalogAnchor
} from './privateLiquidityChain';
import type { ParsedPrivateLiquidityV1Log } from './privateLiquidityEvents';
import {
  getPrivateLiquidityHistorySyncScope,
  type PrivateLiquidityHistorySyncState
} from './privateLiquiditySync';

const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;

export type PrivateLiquidityCatalogEntry = Readonly<{
  positionId: string;
  pairKey: string;
  baseToken: string;
  quoteToken: string;
  initialOwner: string;
  /** Discovery evidence only. Every actionable owner is re-read from a canonical position view. */
  lastObservedOwner: string;
  createdAt: string;
  creationEventKey: string;
  lastTransferEventKey: string;
}>;

declare const CANONICAL_PRIVATE_LIQUIDITY_CATALOG_BRAND: unique symbol;
export type CanonicalPrivateLiquidityPositionCatalog = Readonly<{
  scope: CanonicalPrivateLiquidityCatalogAnchor['scope'];
  atBlock: CanonicalPrivateLiquidityCatalogAnchor['atBlock'];
  positionCount: string;
  entries: readonly PrivateLiquidityCatalogEntry[];
  readonly [CANONICAL_PRIVATE_LIQUIDITY_CATALOG_BRAND]: true;
}>;

export type PrivateLiquidityCatalogPage = Readonly<{
  positionIds: readonly string[];
  nextOffset?: string;
  complete: boolean;
}>;

const CATALOGS = new WeakSet<object>();

const decimal = (value: string, label: string): bigint => {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
    throw new Error(`${label} must be canonical decimal.`);
  }
  return BigInt(value);
};

const sameScope = (
  left: CanonicalPrivateLiquidityCatalogAnchor['scope'],
  right: CanonicalPrivateLiquidityCatalogAnchor['scope']
): boolean => left.chainId === right.chainId &&
  left.contractAddress === right.contractAddress &&
  left.deploymentBlock === right.deploymentBlock;

const compareEvents = (left: ParsedPrivateLiquidityV1Log, right: ParsedPrivateLiquidityV1Log): number => {
  const leftBlock = decimal(left.provenance.blockNumber, 'Left event block');
  const rightBlock = decimal(right.provenance.blockNumber, 'Right event block');
  return leftBlock < rightBlock ? -1 : leftBlock > rightBlock ? 1
    : left.provenance.transactionIndex - right.provenance.transactionIndex ||
      left.provenance.logIndex - right.provenance.logIndex;
};

export const assertCanonicalPrivateLiquidityPositionCatalog = (
  catalog: CanonicalPrivateLiquidityPositionCatalog
): void => {
  if (!catalog || !CATALOGS.has(catalog)) {
    throw new Error('Private-liquidity position catalog is not canonical event-derived state.');
  }
};

/**
 * Materializes only after finalized range pages cover every block from deployment through the
 * block-pinned nextPositionId anchor. ERC-721 Transfer is discovery evidence; action authority
 * always comes from a later canonical getPositionView snapshot.
 */
export const materializeCanonicalPrivateLiquidityPositionCatalog = ({
  deployment,
  syncState,
  anchor
}: {
  deployment: AttestedPrivateLiquidityDeployment;
  syncState: PrivateLiquidityHistorySyncState;
  anchor: CanonicalPrivateLiquidityCatalogAnchor;
}): CanonicalPrivateLiquidityPositionCatalog => {
  assertAttestedPrivateLiquidityDeployment(deployment);
  assertCanonicalPrivateLiquidityCatalogAnchor(anchor);
  const deploymentScope = Object.freeze({
    chainId: deployment.chainId,
    contractAddress: deployment.contractAddress,
    deploymentBlock: deployment.deploymentBlock
  });
  if (!sameScope(anchor.scope, deploymentScope)) {
    throw new Error('Private-liquidity catalog anchor belongs to another deployment.');
  }
  const scope = getPrivateLiquidityHistorySyncScope({ state: syncState, deployment });
  if (!scope.checkpoint || scope.pages.length === 0) {
    throw new Error('Private-liquidity event history is not complete through its catalog anchor.');
  }
  if (
    scope.checkpoint.blockNumber !== anchor.atBlock.number ||
    scope.checkpoint.blockHash !== anchor.atBlock.hash
  ) {
    throw new Error('Private-liquidity event checkpoint does not match its catalog anchor.');
  }

  const deploymentBlock = decimal(deployment.deploymentBlock, 'Private-liquidity deployment block');
  const anchorBlock = decimal(anchor.atBlock.number, 'Private-liquidity catalog anchor block');
  const pages = [...scope.pages].sort((left, right) => {
    const leftStart = decimal(left.range.fromBlock, 'Left private-liquidity range start');
    const rightStart = decimal(right.range.fromBlock, 'Right private-liquidity range start');
    return leftStart < rightStart ? -1 : leftStart > rightStart ? 1 : 0;
  });
  let coveredThrough = deploymentBlock - 1n;
  let anchorHashCovered = false;
  const eventsByKey = new Map<string, ParsedPrivateLiquidityV1Log>();
  for (const page of pages) {
    assertCanonicalPrivateLiquidityLogRange(page);
    if (!sameScope(page.scope, deploymentScope)) {
      throw new Error('Private-liquidity event page belongs to another deployment.');
    }
    const fromBlock = decimal(page.range.fromBlock, 'Private-liquidity range start');
    const toBlock = decimal(page.range.toBlock, 'Private-liquidity range end');
    if (fromBlock < deploymentBlock || toBlock > anchorBlock || fromBlock > coveredThrough + 1n) {
      throw new Error('Private-liquidity event pages contain a gap or exceed the catalog anchor.');
    }
    if (toBlock > coveredThrough) coveredThrough = toBlock;
    if (toBlock === anchorBlock) {
      if (page.range.toBlockHash !== anchor.atBlock.hash) {
        throw new Error('Private-liquidity anchor range has another block hash.');
      }
      anchorHashCovered = true;
    }
    for (const event of page.events) {
      const eventBlock = decimal(event.provenance.blockNumber, 'Private-liquidity event block');
      if (
        event.provenance.chainId !== deployment.chainId ||
        (event.kind !== 'position-transfer' &&
          event.provenance.contractAddress !== deployment.contractAddress) ||
        eventBlock < fromBlock || eventBlock > toBlock
      ) {
        throw new Error('Private-liquidity event falls outside its canonical page.');
      }
      const prior = eventsByKey.get(event.rawEventKey);
      if (prior && JSON.stringify(prior) !== JSON.stringify(event)) {
        throw new Error('Private-liquidity overlapping pages disagree on one physical event.');
      }
      if (!prior) eventsByKey.set(event.rawEventKey, event);
    }
  }
  if (coveredThrough !== anchorBlock || !anchorHashCovered) {
    throw new Error('Private-liquidity event pages do not completely cover the catalog anchor.');
  }

  type MutableEntry = {
    positionId: string;
    pairKey: string;
    baseToken: string;
    quoteToken: string;
    initialOwner: string;
    lastObservedOwner: string;
    createdAt: string;
    creationEventKey: string;
    lastTransferEventKey: string;
  };
  const minted = new Map<string, Extract<ParsedPrivateLiquidityV1Log, { kind: 'position-transfer' }>>();
  const entries = new Map<string, MutableEntry>();
  for (const event of [...eventsByKey.values()].sort(compareEvents)) {
    if (event.kind === 'position-transfer') {
      if (event.from === ZERO_ADDRESS) {
        if (event.to === ZERO_ADDRESS || minted.has(event.positionId) || entries.has(event.positionId)) {
          throw new Error('Private-liquidity position has an invalid or duplicate mint event.');
        }
        minted.set(event.positionId, event);
        continue;
      }
      if (event.to === ZERO_ADDRESS) {
        throw new Error('Private-liquidity runtime unexpectedly burned a position NFT.');
      }
      const entry = entries.get(event.positionId);
      if (!entry || entry.lastObservedOwner !== event.from) {
        throw new Error('Private-liquidity position transfer does not follow observed ERC-721 ownership.');
      }
      entry.lastObservedOwner = event.to;
      entry.lastTransferEventKey = event.rawEventKey;
      continue;
    }
    if (event.kind !== 'position-created') continue;
    if (event.positionId === '0' || event.revision !== '1' || entries.has(event.positionId)) {
      throw new Error('Private-liquidity position creation is invalid or duplicated.');
    }
    const mint = minted.get(event.positionId);
    if (!mint || mint.to !== event.positionOwner ||
        mint.provenance.transactionHash !== event.provenance.transactionHash ||
        mint.provenance.logIndex >= event.provenance.logIndex) {
      throw new Error('Private-liquidity position creation is not paired with its preceding NFT mint.');
    }
    minted.delete(event.positionId);
    entries.set(event.positionId, {
      positionId: event.positionId,
      pairKey: event.pairKey,
      baseToken: event.baseToken,
      quoteToken: event.quoteToken,
      initialOwner: event.positionOwner,
      lastObservedOwner: event.positionOwner,
      createdAt: event.createdAt,
      creationEventKey: event.rawEventKey,
      lastTransferEventKey: mint.rawEventKey
    });
  }
  if (minted.size !== 0) {
    throw new Error('Private-liquidity catalog contains an NFT mint without position creation.');
  }
  const expectedCount = decimal(anchor.positionCount, 'Private-liquidity catalog position count');
  if (BigInt(entries.size) !== expectedCount) {
    throw new Error('Private-liquidity creation events do not match the on-chain position count.');
  }
  const ordered = [...entries.values()]
    .sort((left, right) => BigInt(left.positionId) < BigInt(right.positionId) ? -1 : 1)
    .map((entry, index) => {
      if (BigInt(entry.positionId) !== BigInt(index + 1)) {
        throw new Error('Private-liquidity position IDs are not a contiguous on-chain catalog.');
      }
      return Object.freeze({ ...entry });
    });
  const catalog = Object.freeze({
    scope: anchor.scope,
    atBlock: anchor.atBlock,
    positionCount: anchor.positionCount,
    entries: Object.freeze(ordered)
  }) as CanonicalPrivateLiquidityPositionCatalog;
  CATALOGS.add(catalog);
  return catalog;
};

export const readCanonicalPrivateLiquidityCatalogPage = ({
  catalog,
  offset = '0',
  limit
}: {
  catalog: CanonicalPrivateLiquidityPositionCatalog;
  offset?: string;
  limit: number;
}): PrivateLiquidityCatalogPage => {
  assertCanonicalPrivateLiquidityPositionCatalog(catalog);
  const parsedOffset = decimal(offset, 'Private-liquidity catalog offset');
  if (parsedOffset > BigInt(Number.MAX_SAFE_INTEGER) || !Number.isSafeInteger(limit) || limit < 1 || limit > 128) {
    throw new Error('Private-liquidity catalog page must use a safe offset and a 1-128 limit.');
  }
  const start = Number(parsedOffset);
  if (start > catalog.entries.length) throw new Error('Private-liquidity catalog offset exceeds its position count.');
  const end = Math.min(start + limit, catalog.entries.length);
  return Object.freeze({
    positionIds: Object.freeze(catalog.entries.slice(start, end).map(({ positionId }) => positionId)),
    ...(end < catalog.entries.length ? { nextOffset: end.toString() } : {}),
    complete: end === catalog.entries.length
  });
};
