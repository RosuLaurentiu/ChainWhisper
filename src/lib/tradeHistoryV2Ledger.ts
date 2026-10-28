import { getAddress } from '@coti-io/coti-ethers';

const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;

export type TradeHistoryV2Protocol =
  | 'standard-v2'
  | 'private-v2'
  | 'direct-v2'
  | 'recurring-v2'
  | 'private-recurring-v2';

export type TradeHistoryV2Side = 'fill' | 'accept' | 'buy' | 'sell';

export type TradeHistoryV2OrderRef = {
  chainId: string;
  contractAddress: string;
  orderId: string;
};

export type TradeHistoryV2LogRef = {
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
};

export type TradeHistoryV2Amounts = {
  offerAmount?: string;
  requestAmount?: string;
  baseAmount?: string;
  quoteAmount?: string;
};

export type TradeHistoryV2PostState = {
  remainingOfferAmount?: string;
  remainingRequestAmount?: string;
  baseInventory?: string;
  quoteInventory?: string;
};

export type TradeHistoryV2Observation = {
  schema: 1;
  protocol: TradeHistoryV2Protocol;
  order: TradeHistoryV2OrderRef;
  sequence: string;
  maker: string;
  participant: string;
  side: TradeHistoryV2Side;
  source: 'public-event' | 'private-marker' | 'participant-receipt';
  recipient?: string;
  amounts: TradeHistoryV2Amounts;
  postState?: TradeHistoryV2PostState;
  log: TradeHistoryV2LogRef;
};

export type TradeHistoryV2RangePage = {
  schema: 1;
  chainId: string;
  contractAddress: string;
  fromBlock: string;
  toBlock: string;
  fromBlockHash: string;
  toBlockHash: string;
  observations: readonly TradeHistoryV2Observation[];
};

export type TradeHistoryV2LedgerState = {
  observationsByPhysicalKey: Readonly<Record<string, TradeHistoryV2Observation>>;
  revisionsByScope: Readonly<Record<string, number>>;
};

export type TradeHistoryV2ExecutionRow = {
  key: string;
  protocol: TradeHistoryV2Protocol;
  order: TradeHistoryV2OrderRef;
  sequence: string;
  maker: string;
  participant: string;
  side: TradeHistoryV2Side;
  amountState: 'available' | 'unavailable';
  amounts: TradeHistoryV2Amounts;
  source: TradeHistoryV2Observation['source'];
  log: TradeHistoryV2LogRef;
};

export type TradeHistoryV2OrderAggregate = {
  order: TradeHistoryV2OrderRef;
  protocol: TradeHistoryV2Protocol;
  executionCount: string;
  exactExecutionCount: string;
  hiddenExecutionCount: string;
  offerAmount: string;
  requestAmount: string;
  baseAmount: string;
  quoteAmount: string;
};

const parseDecimal = (value: string, label: string, maximum = UINT256_MAX): bigint => {
  const normalized = value.trim();
  if (!DECIMAL_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a canonical decimal string.`);
  }
  const parsed = BigInt(normalized);
  if (parsed > maximum) throw new Error(`${label} is out of range.`);
  return parsed;
};

const normalizeBytes32 = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!BYTES32_PATTERN.test(normalized)) throw new Error(`${label} must be a 32-byte hex value.`);
  return normalized.toLowerCase();
};

const normalizeIndex = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer.`);
  return value;
};

export const normalizeTradeHistoryV2OrderRef = (
  order: TradeHistoryV2OrderRef
): TradeHistoryV2OrderRef => {
  const chainId = parseDecimal(order.chainId, 'Trade-history chain ID');
  if (chainId === 0n) throw new Error('Trade-history chain ID must be non-zero.');
  return {
    chainId: chainId.toString(),
    contractAddress: getAddress(order.contractAddress.trim()).toLowerCase(),
    orderId: parseDecimal(order.orderId, 'Trade-history order ID').toString()
  };
};

export const buildTradeHistoryV2ScopeKey = (order: Pick<TradeHistoryV2OrderRef, 'chainId' | 'contractAddress'>): string => {
  const normalized = normalizeTradeHistoryV2OrderRef({ ...order, orderId: '0' });
  return `chainwhisper-trade-history-v2:${normalized.chainId}:${normalized.contractAddress}`;
};

export const buildTradeHistoryV2OrderKey = (order: TradeHistoryV2OrderRef): string => {
  const normalized = normalizeTradeHistoryV2OrderRef(order);
  return `${buildTradeHistoryV2ScopeKey(normalized)}:${normalized.orderId}`;
};

export const buildTradeHistoryV2PhysicalKey = ({
  order,
  log
}: Pick<TradeHistoryV2Observation, 'order' | 'log'>): string => {
  const normalizedOrder = normalizeTradeHistoryV2OrderRef(order);
  return [
    buildTradeHistoryV2ScopeKey(normalizedOrder),
    normalizeBytes32(log.blockHash, 'Trade-history block hash'),
    normalizeBytes32(log.transactionHash, 'Trade-history transaction hash'),
    normalizeIndex(log.logIndex, 'Trade-history log index').toString()
  ].join(':');
};

const normalizeAmounts = (amounts: TradeHistoryV2Amounts): TradeHistoryV2Amounts => {
  const normalized: TradeHistoryV2Amounts = {};
  for (const field of ['offerAmount', 'requestAmount', 'baseAmount', 'quoteAmount'] as const) {
    const value = amounts[field];
    if (value !== undefined) normalized[field] = parseDecimal(value, `Trade-history ${field}`).toString();
  }
  return normalized;
};

const normalizePostState = (postState?: TradeHistoryV2PostState): TradeHistoryV2PostState | undefined => {
  if (!postState) return undefined;
  const normalized: TradeHistoryV2PostState = {};
  for (const field of [
    'remainingOfferAmount',
    'remainingRequestAmount',
    'baseInventory',
    'quoteInventory'
  ] as const) {
    const value = postState[field];
    if (value !== undefined) normalized[field] = parseDecimal(value, `Trade-history ${field}`).toString();
  }
  return normalized;
};

const hasExactPair = (protocol: TradeHistoryV2Protocol, amounts: TradeHistoryV2Amounts): boolean => {
  if (protocol === 'recurring-v2' || protocol === 'private-recurring-v2') {
    return amounts.baseAmount !== undefined && amounts.quoteAmount !== undefined;
  }
  return amounts.offerAmount !== undefined && amounts.requestAmount !== undefined;
};

export const normalizeTradeHistoryV2Observation = (
  observation: TradeHistoryV2Observation
): TradeHistoryV2Observation => {
  if (observation.schema !== 1) throw new Error('Trade-history observation schema is unsupported.');
  const order = normalizeTradeHistoryV2OrderRef(observation.order);
  const maker = getAddress(observation.maker.trim()).toLowerCase();
  const participant = getAddress(observation.participant.trim()).toLowerCase();
  const recipient = observation.recipient
    ? getAddress(observation.recipient.trim()).toLowerCase()
    : undefined;
  if (observation.source === 'participant-receipt' && !recipient) {
    throw new Error('A private trade-history receipt requires its exact recipient.');
  }
  if (observation.source !== 'participant-receipt' && recipient) {
    throw new Error('Only a private trade-history receipt may carry a recipient.');
  }
  const amounts = normalizeAmounts(observation.amounts);
  if (observation.source === 'private-marker' && Object.keys(amounts).length !== 0) {
    throw new Error('A private trade-history marker must not expose amounts.');
  }
  if (observation.source !== 'private-marker' && !hasExactPair(observation.protocol, amounts)) {
    throw new Error('An exact trade-history observation requires both economic amounts.');
  }
  const blockNumber = parseDecimal(observation.log.blockNumber, 'Trade-history block number');
  const sequence = parseDecimal(observation.sequence, 'Trade-history execution sequence', UINT64_MAX);
  if (sequence === 0n) throw new Error('Trade-history execution sequence must be non-zero.');
  return {
    ...observation,
    order,
    sequence: sequence.toString(),
    maker,
    participant,
    recipient,
    amounts,
    postState: normalizePostState(observation.postState),
    log: {
      blockNumber: blockNumber.toString(),
      blockHash: normalizeBytes32(observation.log.blockHash, 'Trade-history block hash'),
      transactionHash: normalizeBytes32(observation.log.transactionHash, 'Trade-history transaction hash'),
      transactionIndex: normalizeIndex(observation.log.transactionIndex, 'Trade-history transaction index'),
      logIndex: normalizeIndex(observation.log.logIndex, 'Trade-history log index')
    }
  };
};

export const createTradeHistoryV2LedgerState = (): TradeHistoryV2LedgerState => ({
  observationsByPhysicalKey: {},
  revisionsByScope: {}
});

export const getTradeHistoryV2LedgerRevision = ({
  state,
  chainId,
  contractAddress
}: {
  state: TradeHistoryV2LedgerState;
  chainId: string;
  contractAddress: string;
}): number => state.revisionsByScope[buildTradeHistoryV2ScopeKey({ chainId, contractAddress })] ?? 0;

export const clearTradeHistoryV2Scope = ({
  previous,
  chainId,
  contractAddress,
  expectedRevision
}: {
  previous: TradeHistoryV2LedgerState;
  chainId: string;
  contractAddress: string;
  expectedRevision: number;
}): TradeHistoryV2LedgerState => {
  const scopeKey = buildTradeHistoryV2ScopeKey({ chainId, contractAddress });
  const currentRevision = previous.revisionsByScope[scopeKey] ?? 0;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision !== currentRevision) {
    throw new Error('Trade-history scope clear was produced from a stale ledger revision.');
  }
  const observationsByPhysicalKey = Object.fromEntries(
    Object.entries(previous.observationsByPhysicalKey).filter(
      ([, observation]) => buildTradeHistoryV2ScopeKey(observation.order) !== scopeKey
    )
  );
  return {
    observationsByPhysicalKey,
    revisionsByScope: {
      ...previous.revisionsByScope,
      [scopeKey]: currentRevision + 1
    }
  };
};

const normalizeRangePage = (page: TradeHistoryV2RangePage): TradeHistoryV2RangePage => {
  if (page.schema !== 1) throw new Error('Trade-history range schema is unsupported.');
  const scope = normalizeTradeHistoryV2OrderRef({
    chainId: page.chainId,
    contractAddress: page.contractAddress,
    orderId: '0'
  });
  const fromBlock = parseDecimal(page.fromBlock, 'Trade-history range start');
  const toBlock = parseDecimal(page.toBlock, 'Trade-history range end');
  if (fromBlock > toBlock) throw new Error('Trade-history range is reversed.');
  const observations = page.observations.map(normalizeTradeHistoryV2Observation);
  const seen = new Map<string, string>();
  for (const observation of observations) {
    if (
      observation.order.chainId !== scope.chainId ||
      observation.order.contractAddress !== scope.contractAddress
    ) {
      throw new Error('Trade-history observation belongs to a different chain or contract.');
    }
    const blockNumber = BigInt(observation.log.blockNumber);
    if (blockNumber < fromBlock || blockNumber > toBlock) {
      throw new Error('Trade-history observation is outside its replacement range.');
    }
    const physicalKey = buildTradeHistoryV2PhysicalKey(observation);
    const serialized = JSON.stringify(observation);
    const previous = seen.get(physicalKey);
    if (previous && previous !== serialized) {
      throw new Error('Conflicting trade-history observations share one physical log identity.');
    }
    seen.set(physicalKey, serialized);
  }
  return {
    schema: 1,
    chainId: scope.chainId,
    contractAddress: scope.contractAddress,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    fromBlockHash: normalizeBytes32(page.fromBlockHash, 'Trade-history range start hash'),
    toBlockHash: normalizeBytes32(page.toBlockHash, 'Trade-history range end hash'),
    observations
  };
};

/**
 * Atomically replaces one complete provider-owned block range for an exact chain/contract scope.
 * The chain adapter remains responsible for safe-head selection, EIP-1898 reads, boundary checks,
 * bounded overlap, and deciding which range to replay after a removed-log or block-hash signal.
 */
export const replaceTradeHistoryV2Range = ({
  previous,
  page: untrustedPage,
  expectedRevision
}: {
  previous: TradeHistoryV2LedgerState;
  page: TradeHistoryV2RangePage;
  expectedRevision: number;
}): TradeHistoryV2LedgerState => {
  const page = normalizeRangePage(untrustedPage);
  const scopeKey = buildTradeHistoryV2ScopeKey(page);
  const currentRevision = previous.revisionsByScope[scopeKey] ?? 0;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision !== currentRevision) {
    throw new Error('Trade-history range was produced from a stale ledger revision.');
  }
  const fromBlock = BigInt(page.fromBlock);
  const toBlock = BigInt(page.toBlock);
  const nextObservations: Record<string, TradeHistoryV2Observation> = {};
  for (const [key, observation] of Object.entries(previous.observationsByPhysicalKey)) {
    const observationScope = buildTradeHistoryV2ScopeKey(observation.order);
    const blockNumber = BigInt(observation.log.blockNumber);
    if (observationScope === scopeKey && blockNumber >= fromBlock && blockNumber <= toBlock) continue;
    nextObservations[key] = observation;
  }
  for (const observation of page.observations) {
    nextObservations[buildTradeHistoryV2PhysicalKey(observation)] = observation;
  }
  return {
    observationsByPhysicalKey: nextObservations,
    revisionsByScope: {
      ...previous.revisionsByScope,
      [scopeKey]: currentRevision + 1
    }
  };
};

const buildSemanticExecutionKey = (observation: TradeHistoryV2Observation): string =>
  `${buildTradeHistoryV2OrderKey(observation.order)}:${observation.sequence}`;

const assertConsistentExecution = (
  left: TradeHistoryV2Observation,
  right: TradeHistoryV2Observation
): void => {
  if (
    left.protocol !== right.protocol ||
    left.maker !== right.maker ||
    left.participant !== right.participant ||
    left.side !== right.side
  ) {
    throw new Error('Trade-history observations disagree about one semantic execution.');
  }
};

const observationPreference = (
  observation: TradeHistoryV2Observation,
  viewer: string
): number => {
  if (observation.source === 'participant-receipt') return observation.recipient === viewer ? 3 : -1;
  if (observation.source === 'public-event') return 2;
  return 1;
};

export const projectTradeHistoryV2Rows = ({
  state,
  viewerAddress
}: {
  state: TradeHistoryV2LedgerState;
  viewerAddress: string;
}): TradeHistoryV2ExecutionRow[] => {
  const viewer = getAddress(viewerAddress.trim()).toLowerCase();
  const selected = new Map<string, TradeHistoryV2Observation>();
  for (const observation of Object.values(state.observationsByPhysicalKey)) {
    if (viewer !== observation.maker && viewer !== observation.participant) continue;
    const semanticKey = buildSemanticExecutionKey(observation);
    const current = selected.get(semanticKey);
    if (current) assertConsistentExecution(current, observation);
    if (observationPreference(observation, viewer) > observationPreference(current ?? observation, viewer)) {
      selected.set(semanticKey, observation);
    } else if (!current && observationPreference(observation, viewer) >= 0) {
      selected.set(semanticKey, observation);
    }
  }
  return [...selected.values()]
    .map((observation): TradeHistoryV2ExecutionRow => {
      const available = hasExactPair(observation.protocol, observation.amounts);
      return {
        key: buildSemanticExecutionKey(observation),
        protocol: observation.protocol,
        order: observation.order,
        sequence: observation.sequence,
        maker: observation.maker,
        participant: observation.participant,
        side: observation.side,
        amountState: available ? 'available' : 'unavailable',
        amounts: available ? observation.amounts : {},
        source: observation.source,
        log: observation.log
      };
    })
    .sort((left, right) => {
      const blockComparison = BigInt(left.log.blockNumber) - BigInt(right.log.blockNumber);
      if (blockComparison !== 0n) return blockComparison < 0n ? -1 : 1;
      if (left.log.transactionIndex !== right.log.transactionIndex) {
        return left.log.transactionIndex - right.log.transactionIndex;
      }
      return left.log.logIndex - right.log.logIndex;
    });
};

const addDecimal = (left: string, right?: string): string =>
  (BigInt(left) + BigInt(right ?? '0')).toString();

export const aggregateTradeHistoryV2Rows = (
  rows: readonly TradeHistoryV2ExecutionRow[]
): TradeHistoryV2OrderAggregate[] => {
  const byOrder = new Map<string, TradeHistoryV2OrderAggregate>();
  for (const row of rows) {
    const key = buildTradeHistoryV2OrderKey(row.order);
    const aggregate = byOrder.get(key) ?? {
      order: row.order,
      protocol: row.protocol,
      executionCount: '0',
      exactExecutionCount: '0',
      hiddenExecutionCount: '0',
      offerAmount: '0',
      requestAmount: '0',
      baseAmount: '0',
      quoteAmount: '0'
    };
    if (aggregate.protocol !== row.protocol) {
      throw new Error('Trade-history rows disagree about an order protocol.');
    }
    aggregate.executionCount = addDecimal(aggregate.executionCount, '1');
    if (row.amountState === 'available') {
      aggregate.exactExecutionCount = addDecimal(aggregate.exactExecutionCount, '1');
      aggregate.offerAmount = addDecimal(aggregate.offerAmount, row.amounts.offerAmount);
      aggregate.requestAmount = addDecimal(aggregate.requestAmount, row.amounts.requestAmount);
      aggregate.baseAmount = addDecimal(aggregate.baseAmount, row.amounts.baseAmount);
      aggregate.quoteAmount = addDecimal(aggregate.quoteAmount, row.amounts.quoteAmount);
    } else {
      aggregate.hiddenExecutionCount = addDecimal(aggregate.hiddenExecutionCount, '1');
    }
    byOrder.set(key, aggregate);
  }
  return [...byOrder.values()];
};
