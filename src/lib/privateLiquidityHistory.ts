import {
  buildPrivateLiquidityPositionKey,
  normalizePrivateLiquidityAddress,
  parsePrivateLiquidityUint,
  type PrivateLiquidityDirection,
  type PrivateLiquidityPositionIdentity
} from './privateLiquidity';

export type PrivateLiquidityEventProvenance = Readonly<{
  chainId: string;
  contractAddress: string;
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
}>;

export type PrivateLiquiditySwapMarker = Readonly<{
  provenance: PrivateLiquidityEventProvenance;
  swapId: string;
  trader: string;
  pairKey: string;
  direction: PrivateLiquidityDirection;
  candidateCount: number;
}>;

export type DecryptedPrivateLiquidityTraderReceipt = Readonly<{
  provenance: PrivateLiquidityEventProvenance;
  swapId: string;
  recipient: string;
  pairKey: string;
  direction: PrivateLiquidityDirection;
  inputAmount: string;
  outputAmount: string;
  unusedInputAmount: string;
}>;

export type DecryptedPrivateLiquidityPositionReceipt = Readonly<{
  provenance: PrivateLiquidityEventProvenance;
  positionId: string;
  swapId: string;
  recipient: string;
  direction: PrivateLiquidityDirection;
  baseAmount: string;
  quoteAmount: string;
}>;

export type PrivateLiquidityTraderHistoryRow = Readonly<{
  kind: 'private-liquidity-swap';
  key: string;
  swapId: string;
  direction: PrivateLiquidityDirection;
  pairKey: string;
  inputAmount: string;
  outputAmount: string;
  unusedInputAmount: string;
  candidateCount: number;
  provenance: PrivateLiquidityEventProvenance;
}>;

export type PrivateLiquidityPositionHistoryRow = Readonly<{
  kind: 'private-liquidity-position-fill';
  key: string;
  positionKey: string;
  positionId: string;
  swapId: string;
  direction: PrivateLiquidityDirection;
  baseAmount: string;
  quoteAmount: string;
  provenance: PrivateLiquidityEventProvenance;
}>;

export type PrivateLiquidityPositionHistoryTotals = Readonly<{
  positionKey: string;
  positionId: string;
  fillCount: number;
  baseReceived: string;
  basePaid: string;
  quoteReceived: string;
  quotePaid: string;
}>;

export type PrivateLiquidityHistory = Readonly<{
  traderRows: readonly PrivateLiquidityTraderHistoryRow[];
  positionRows: readonly PrivateLiquidityPositionHistoryRow[];
  positionTotals: readonly PrivateLiquidityPositionHistoryTotals[];
}>;

export type MaterializePrivateLiquidityHistoryInput = Readonly<{
  viewer: string;
  markers: readonly PrivateLiquiditySwapMarker[];
  traderReceipts: readonly DecryptedPrivateLiquidityTraderReceipt[];
  positionReceipts: readonly DecryptedPrivateLiquidityPositionReceipt[];
}>;

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

const normalizeHash = (value: string, label: string): string => {
  if (!HASH_PATTERN.test(value)) {
    throw new Error(`${label} must be a 32-byte hex value.`);
  }
  return value.toLowerCase();
};

const validateProvenance = (
  provenance: PrivateLiquidityEventProvenance
): PrivateLiquidityEventProvenance => {
  const chainId = parsePrivateLiquidityUint(provenance.chainId, 'Event chain ID');
  const blockNumber = parsePrivateLiquidityUint(provenance.blockNumber, 'Event block number');
  if (chainId <= 0n || blockNumber <= 0n) {
    throw new Error('Event chain and block numbers must be positive.');
  }
  normalizePrivateLiquidityAddress(provenance.contractAddress, 'Event contract');
  normalizeHash(provenance.blockHash, 'Event block hash');
  normalizeHash(provenance.transactionHash, 'Event transaction hash');
  if (
    !Number.isSafeInteger(provenance.transactionIndex) ||
    provenance.transactionIndex < 0 ||
    !Number.isSafeInteger(provenance.logIndex) ||
    provenance.logIndex < 0
  ) {
    throw new Error('Event transaction and log indexes must be non-negative safe integers.');
  }
  return provenance;
};

export const buildPrivateLiquidityRawEventKey = (
  provenance: PrivateLiquidityEventProvenance
): string => {
  validateProvenance(provenance);
  return [
    parsePrivateLiquidityUint(provenance.chainId, 'Event chain ID').toString(),
    normalizePrivateLiquidityAddress(provenance.contractAddress, 'Event contract'),
    normalizeHash(provenance.blockHash, 'Event block hash'),
    normalizeHash(provenance.transactionHash, 'Event transaction hash'),
    provenance.logIndex.toString()
  ].join(':');
};

const sameTransaction = (
  left: PrivateLiquidityEventProvenance,
  right: PrivateLiquidityEventProvenance
): boolean =>
  parsePrivateLiquidityUint(left.chainId, 'Left chain ID') ===
    parsePrivateLiquidityUint(right.chainId, 'Right chain ID') &&
  normalizePrivateLiquidityAddress(left.contractAddress, 'Left contract') ===
    normalizePrivateLiquidityAddress(right.contractAddress, 'Right contract') &&
  normalizeHash(left.blockHash, 'Left block hash') === normalizeHash(right.blockHash, 'Right block hash') &&
  normalizeHash(left.transactionHash, 'Left transaction hash') ===
    normalizeHash(right.transactionHash, 'Right transaction hash');

const normalizeAmount = (value: string, label: string): string =>
  parsePrivateLiquidityUint(value, label).toString();

const buildTransactionSwapKey = (
  provenance: PrivateLiquidityEventProvenance,
  swapId: string
): string =>
  [
    parsePrivateLiquidityUint(provenance.chainId, 'Transaction chain ID').toString(),
    normalizePrivateLiquidityAddress(provenance.contractAddress, 'Transaction contract'),
    normalizeHash(provenance.transactionHash, 'Transaction hash'),
    parsePrivateLiquidityUint(swapId, 'Transaction swap ID').toString()
  ].join(':');

const validateMarker = (marker: PrivateLiquiditySwapMarker): void => {
  validateProvenance(marker.provenance);
  if (parsePrivateLiquidityUint(marker.swapId, 'Swap ID') <= 0n) {
    throw new Error('Swap ID must be positive.');
  }
  normalizePrivateLiquidityAddress(marker.trader, 'Swap trader');
  normalizeHash(marker.pairKey, 'Swap pair key');
  if (
    !Number.isSafeInteger(marker.candidateCount) ||
    marker.candidateCount <= 0 ||
    marker.candidateCount > 8
  ) {
    throw new Error('Swap candidate count must be between 1 and 8.');
  }
};

const validateUniqueEvents = (
  events: readonly { provenance: PrivateLiquidityEventProvenance }[]
): void => {
  const seen = new Set<string>();
  for (const event of events) {
    const key = buildPrivateLiquidityRawEventKey(event.provenance);
    if (seen.has(key)) {
      throw new Error(`Duplicate private-liquidity event ${key}.`);
    }
    seen.add(key);
  }
};

const compareRows = (
  left: { provenance: PrivateLiquidityEventProvenance },
  right: { provenance: PrivateLiquidityEventProvenance }
): number => {
  const blockComparison =
    parsePrivateLiquidityUint(left.provenance.blockNumber, 'Left block') -
    parsePrivateLiquidityUint(right.provenance.blockNumber, 'Right block');
  if (blockComparison !== 0n) return blockComparison < 0n ? -1 : 1;
  if (left.provenance.transactionIndex !== right.provenance.transactionIndex) {
    return left.provenance.transactionIndex - right.provenance.transactionIndex;
  }
  return left.provenance.logIndex - right.provenance.logIndex;
};

export const materializePrivateLiquidityHistory = ({
  viewer,
  markers,
  traderReceipts,
  positionReceipts
}: MaterializePrivateLiquidityHistoryInput): PrivateLiquidityHistory => {
  const normalizedViewer = normalizePrivateLiquidityAddress(viewer, 'History viewer');
  markers.forEach(validateMarker);
  validateUniqueEvents([...markers, ...traderReceipts, ...positionReceipts]);

  const traderRows: PrivateLiquidityTraderHistoryRow[] = [];
  const positionRows: PrivateLiquidityPositionHistoryRow[] = [];
  const markerByTransactionAndSwap = new Map<string, PrivateLiquiditySwapMarker>();
  const traderReceiptCountByMarker = new Map<string, number>();
  const positionReceiptKeys = new Set<string>();

  for (const marker of markers) {
    const markerKey = buildTransactionSwapKey(marker.provenance, marker.swapId);
    if (markerByTransactionAndSwap.has(markerKey)) {
      throw new Error(`Duplicate private-liquidity swap marker ${markerKey}.`);
    }
    markerByTransactionAndSwap.set(markerKey, marker);
  }

  for (const receipt of traderReceipts) {
    validateProvenance(receipt.provenance);
    const recipient = normalizePrivateLiquidityAddress(receipt.recipient, 'Trader receipt recipient');
    if (recipient !== normalizedViewer) continue;
    const swapId = parsePrivateLiquidityUint(receipt.swapId, 'Trader receipt swap ID').toString();
    const markerKey = buildTransactionSwapKey(receipt.provenance, swapId);
    const marker = markerByTransactionAndSwap.get(markerKey);
    if (!marker || !sameTransaction(marker.provenance, receipt.provenance)) {
      throw new Error('Trader receipt has no exact same-transaction swap marker.');
    }
    if (
      normalizePrivateLiquidityAddress(marker.trader, 'Marker trader') !== recipient ||
      marker.direction !== receipt.direction ||
      normalizeHash(marker.pairKey, 'Marker pair') !== normalizeHash(receipt.pairKey, 'Receipt pair')
    ) {
      throw new Error('Trader receipt does not match its swap marker.');
    }
    const nextReceiptCount = (traderReceiptCountByMarker.get(markerKey) ?? 0) + 1;
    if (nextReceiptCount !== 1) {
      throw new Error('Swap marker has more than one viewer trader receipt.');
    }
    traderReceiptCountByMarker.set(markerKey, nextReceiptCount);
    const inputAmount = normalizeAmount(receipt.inputAmount, 'Trader input amount');
    const outputAmount = normalizeAmount(receipt.outputAmount, 'Trader output amount');
    const unusedInputAmount = normalizeAmount(receipt.unusedInputAmount, 'Trader unused input amount');
    if (inputAmount === '0' || outputAmount === '0') {
      throw new Error('Successful trader receipts must contain positive amounts.');
    }
    traderRows.push(
      Object.freeze({
        kind: 'private-liquidity-swap',
        key: `private-liquidity-swap:${buildPrivateLiquidityRawEventKey(marker.provenance)}`,
        swapId,
        direction: marker.direction,
        pairKey: normalizeHash(marker.pairKey, 'Marker pair'),
        inputAmount,
        outputAmount,
        unusedInputAmount,
        candidateCount: marker.candidateCount,
        provenance: marker.provenance
      })
    );
  }

  for (const receipt of positionReceipts) {
    validateProvenance(receipt.provenance);
    const recipient = normalizePrivateLiquidityAddress(receipt.recipient, 'Position receipt recipient');
    if (recipient !== normalizedViewer) continue;
    const swapId = parsePrivateLiquidityUint(receipt.swapId, 'Position receipt swap ID').toString();
    const markerKey = buildTransactionSwapKey(receipt.provenance, swapId);
    const marker = markerByTransactionAndSwap.get(markerKey);
    if (!marker || !sameTransaction(marker.provenance, receipt.provenance)) {
      throw new Error('Position receipt has no exact same-transaction swap marker.');
    }
    if (marker.direction !== receipt.direction) {
      throw new Error('Position receipt direction does not match its swap marker.');
    }
    const positionId = parsePrivateLiquidityUint(receipt.positionId, 'Position ID').toString();
    const positionReceiptKey = `${markerKey}:${positionId}:${recipient}`;
    if (positionReceiptKeys.has(positionReceiptKey)) {
      throw new Error('Swap marker has more than one receipt for the same position and viewer.');
    }
    positionReceiptKeys.add(positionReceiptKey);
    const baseAmount = normalizeAmount(receipt.baseAmount, 'Position base amount');
    const quoteAmount = normalizeAmount(receipt.quoteAmount, 'Position quote amount');
    if ((baseAmount === '0') !== (quoteAmount === '0')) {
      throw new Error('Position receipt must contain either two positive amounts or two zero amounts.');
    }
    if (baseAmount === '0') continue;
    const identity: PrivateLiquidityPositionIdentity = {
      chainId: marker.provenance.chainId,
      contractAddress: marker.provenance.contractAddress,
      positionId
    };
    const positionKey = buildPrivateLiquidityPositionKey(identity);
    positionRows.push(
      Object.freeze({
        kind: 'private-liquidity-position-fill',
        key: `private-liquidity-position-fill:${buildPrivateLiquidityRawEventKey(receipt.provenance)}`,
        positionKey,
        positionId: identity.positionId,
        swapId,
        direction: receipt.direction,
        baseAmount,
        quoteAmount,
        provenance: receipt.provenance
      })
    );
  }

  for (const [markerKey, marker] of markerByTransactionAndSwap) {
    if (
      normalizePrivateLiquidityAddress(marker.trader, 'Marker trader') === normalizedViewer &&
      traderReceiptCountByMarker.get(markerKey) !== 1
    ) {
      throw new Error('Viewer swap marker is missing its exact trader receipt.');
    }
  }

  traderRows.sort(compareRows);
  positionRows.sort(compareRows);
  const totalsByPosition = new Map<
    string,
    {
      positionId: string;
      fillCount: number;
      baseReceived: bigint;
      basePaid: bigint;
      quoteReceived: bigint;
      quotePaid: bigint;
    }
  >();
  for (const row of positionRows) {
    const totals = totalsByPosition.get(row.positionKey) ?? {
      positionId: row.positionId,
      fillCount: 0,
      baseReceived: 0n,
      basePaid: 0n,
      quoteReceived: 0n,
      quotePaid: 0n
    };
    totals.fillCount++;
    if (row.direction === 'base-to-quote') {
      totals.baseReceived += BigInt(row.baseAmount);
      totals.quotePaid += BigInt(row.quoteAmount);
    } else {
      totals.basePaid += BigInt(row.baseAmount);
      totals.quoteReceived += BigInt(row.quoteAmount);
    }
    totalsByPosition.set(row.positionKey, totals);
  }
  const positionTotals = [...totalsByPosition.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([positionKey, totals]): PrivateLiquidityPositionHistoryTotals =>
      Object.freeze({
        positionKey,
        positionId: totals.positionId,
        fillCount: totals.fillCount,
        baseReceived: totals.baseReceived.toString(),
        basePaid: totals.basePaid.toString(),
        quoteReceived: totals.quoteReceived.toString(),
        quotePaid: totals.quotePaid.toString()
      })
    );

  return Object.freeze({
    traderRows: Object.freeze(traderRows),
    positionRows: Object.freeze(positionRows),
    positionTotals: Object.freeze(positionTotals)
  });
};
