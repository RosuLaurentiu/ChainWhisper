import { getAddress } from '@coti-io/coti-ethers';
import {
  projectCanonicalDirectTradeV2ChatEntries,
  type DirectTradeV2ChatEntry
} from './directTradeV2ChatProjection';
import {
  assertCanonicalTradeHistoryV2LogRange,
  type CanonicalTradeHistoryV2LogRange
} from './tradeHistoryV2Chain';
import {
  materializeDirectTradeV2Acceptance,
  materializeTradeHistoryV2ParticipantReceipt,
  type ParsedDirectTradeV2Opened,
  type ParsedDirectTradeV2Status,
  type ParsedTradeHistoryV2Execution,
  type ParsedTradeHistoryV2Lifecycle,
  type ParsedTradeHistoryV2PrivateReceipt
} from './tradeHistoryV2Events';
import {
  buildTradeHistoryV2OrderKey,
  buildTradeHistoryV2ScopeKey,
  type TradeHistoryV2Amounts,
  type TradeHistoryV2Observation,
  type TradeHistoryV2RangePage
} from './tradeHistoryV2Ledger';

declare const TRADE_HISTORY_V2_MATERIALIZATION_STATE_BRAND: unique symbol;
export type TradeHistoryV2MaterializationState = Readonly<{
  directOpeningsByOrderKey: Readonly<Record<string, ParsedDirectTradeV2Opened>>;
  directChatEntriesByPhysicalKey: Readonly<Record<string, DirectTradeV2ChatEntry>>;
  lifecycleEventsByPhysicalKey: Readonly<Record<string, TradeHistoryV2CanonicalLifecycleEvent>>;
  revisionsByScope: Readonly<Record<string, number>>;
  readonly [TRADE_HISTORY_V2_MATERIALIZATION_STATE_BRAND]: true;
}>;

export type TradeHistoryV2CanonicalLifecycleEvent =
  | ParsedDirectTradeV2Opened
  | ParsedDirectTradeV2Status
  | ParsedTradeHistoryV2Lifecycle;

const MATERIALIZATION_STATES = new WeakSet<object>();

const registerMaterializationState = (
  state: Omit<TradeHistoryV2MaterializationState, typeof TRADE_HISTORY_V2_MATERIALIZATION_STATE_BRAND>
): TradeHistoryV2MaterializationState => {
  const frozen = Object.freeze(state) as TradeHistoryV2MaterializationState;
  MATERIALIZATION_STATES.add(frozen);
  return frozen;
};

export const assertTradeHistoryV2MaterializationState = (
  state: TradeHistoryV2MaterializationState
): void => {
  if (!state || !MATERIALIZATION_STATES.has(state)) {
    throw new Error('Trade-history materialization state is not canonically derived.');
  }
};

export type TradeHistoryV2PrivateAmountResolver = (
  receipt: ParsedTradeHistoryV2PrivateReceipt
) => Promise<TradeHistoryV2Amounts | undefined>;

export type TradeHistoryV2DirectPrivateAmountResolver = (input: Readonly<{
  opened: ParsedDirectTradeV2Opened;
  status: ParsedDirectTradeV2Status;
  viewer: string;
}>) => Promise<TradeHistoryV2Amounts | undefined>;

const directOrderKey = (opened: ParsedDirectTradeV2Opened): string => buildTradeHistoryV2OrderKey({
  chainId: opened.chainId,
  contractAddress: opened.contractAddress,
  orderId: opened.orderId
});

const receiptJoinKey = (
  value: ParsedTradeHistoryV2Execution | ParsedTradeHistoryV2PrivateReceipt
): string => {
  const order = value.kind === 'execution'
    ? value.observation.order
    : {
        chainId: value.chainId,
        contractAddress: value.contractAddress,
        orderId: value.orderId
      };
  const log = value.kind === 'execution' ? value.observation.log : value.log;
  return `${buildTradeHistoryV2OrderKey(order)}:${log.blockHash}:${log.transactionHash}`;
};

export const createTradeHistoryV2MaterializationState = (): TradeHistoryV2MaterializationState =>
  registerMaterializationState({
  directOpeningsByOrderKey: Object.freeze({}),
  directChatEntriesByPhysicalKey: Object.freeze({}),
  lifecycleEventsByPhysicalKey: Object.freeze({}),
  revisionsByScope: Object.freeze({})
  });

export const getTradeHistoryV2MaterializationRevision = ({
  state,
  chainId,
  contractAddress
}: {
  state: TradeHistoryV2MaterializationState;
  chainId: string;
  contractAddress: string;
}): number => {
  assertTradeHistoryV2MaterializationState(state);
  return state.revisionsByScope[buildTradeHistoryV2ScopeKey({ chainId, contractAddress })] ?? 0;
};

export const clearTradeHistoryV2MaterializationScope = ({
  previous,
  chainId,
  contractAddress,
  expectedRevision
}: {
  previous: TradeHistoryV2MaterializationState;
  chainId: string;
  contractAddress: string;
  expectedRevision: number;
}): TradeHistoryV2MaterializationState => {
  assertTradeHistoryV2MaterializationState(previous);
  const scopeKey = buildTradeHistoryV2ScopeKey({ chainId, contractAddress });
  const currentRevision = previous.revisionsByScope[scopeKey] ?? 0;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision !== currentRevision) {
    throw new Error('Trade-history materialization clear used a stale revision.');
  }
  return registerMaterializationState({
    directOpeningsByOrderKey: Object.freeze(Object.fromEntries(
      Object.entries(previous.directOpeningsByOrderKey).filter(([, opening]) =>
        buildTradeHistoryV2ScopeKey({
          chainId: opening.chainId,
          contractAddress: opening.contractAddress
        }) !== scopeKey
      )
    )),
    directChatEntriesByPhysicalKey: Object.freeze(Object.fromEntries(
      Object.entries(previous.directChatEntriesByPhysicalKey).filter(([, entry]) => {
        const identity = entry.message.directTradeV2;
        return !identity || buildTradeHistoryV2ScopeKey({
          chainId: identity.chainId,
          contractAddress: identity.contractAddress
        }) !== scopeKey;
      })
    )),
    lifecycleEventsByPhysicalKey: Object.freeze(Object.fromEntries(
      Object.entries(previous.lifecycleEventsByPhysicalKey).filter(([, event]) =>
        buildTradeHistoryV2ScopeKey({
          chainId: event.chainId,
          contractAddress: event.contractAddress
        }) !== scopeKey
      )
    )),
    revisionsByScope: Object.freeze({ ...previous.revisionsByScope, [scopeKey]: currentRevision + 1 })
  });
};

const directChatPhysicalKey = (entry: DirectTradeV2ChatEntry): string => {
  const identity = entry.message.directTradeV2;
  if (!identity) throw new Error('Direct trade chat entry is missing canonical event identity.');
  return [
    identity.chainId,
    identity.contractAddress,
    entry.viewer,
    identity.blockHash,
    identity.transactionHash,
    identity.logIndex.toString()
  ].join(':');
};

const lifecyclePhysicalKey = (event: TradeHistoryV2CanonicalLifecycleEvent): string => [
  event.chainId,
  event.contractAddress,
  event.log.blockHash,
  event.log.transactionHash,
  event.log.logIndex.toString()
].join(':');

export const listTradeHistoryV2LifecycleEvents = ({
  state,
  chainId,
  contractAddress
}: {
  state: TradeHistoryV2MaterializationState;
  chainId: string;
  contractAddress: string;
}): readonly TradeHistoryV2CanonicalLifecycleEvent[] => {
  assertTradeHistoryV2MaterializationState(state);
  const normalizedContract = getAddress(contractAddress).toLowerCase();
  return Object.freeze(Object.values(state.lifecycleEventsByPhysicalKey)
    .filter((event) => event.chainId === chainId && event.contractAddress === normalizedContract)
    .sort((left, right) => {
      const blockOrder = BigInt(left.log.blockNumber) - BigInt(right.log.blockNumber);
      if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1;
      if (left.log.transactionIndex !== right.log.transactionIndex) {
        return left.log.transactionIndex - right.log.transactionIndex;
      }
      return left.log.logIndex - right.log.logIndex;
    }));
};

export const listTradeHistoryV2DirectChatEntries = ({
  state,
  chainId,
  contractAddress,
  viewer
}: {
  state: TradeHistoryV2MaterializationState;
  chainId: string;
  contractAddress: string;
  viewer: string;
}): readonly DirectTradeV2ChatEntry[] => {
  assertTradeHistoryV2MaterializationState(state);
  const normalizedContract = getAddress(contractAddress).toLowerCase();
  const normalizedViewer = getAddress(viewer).toLowerCase();
  return Object.freeze(Object.values(state.directChatEntriesByPhysicalKey)
    .filter((entry) => {
      const identity = entry.message.directTradeV2;
      return identity?.chainId === chainId &&
        identity.contractAddress === normalizedContract &&
        entry.viewer === normalizedViewer;
    })
    .sort((left, right) => {
      const leftIdentity = left.message.directTradeV2!;
      const rightIdentity = right.message.directTradeV2!;
      const blockOrder = BigInt(leftIdentity.blockNumber) - BigInt(rightIdentity.blockNumber);
      if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1;
      return leftIdentity.logIndex - rightIdentity.logIndex;
    }));
};

/**
 * Converts one runtime-branded canonical log page into a ledger page. Direct opening metadata is
 * replaced for the same range at the same time, so an accepted status in a later page can use only
 * canonical immutable terms observed since the last scope replay. The caller must clear this state
 * atomically whenever the ledger/sync coordinator reports a scope reorg.
 */
export const materializeCanonicalTradeHistoryV2Range = async ({
  previous,
  canonicalPage,
  chainId,
  contractAddress,
  expectedRevision,
  viewer,
  resolvePrivateReceiptAmounts,
  resolveDirectPrivateAmounts,
  shouldContinue
}: {
  previous: TradeHistoryV2MaterializationState;
  canonicalPage: CanonicalTradeHistoryV2LogRange;
  chainId: string;
  contractAddress: string;
  expectedRevision: number;
  viewer?: string;
  resolvePrivateReceiptAmounts?: TradeHistoryV2PrivateAmountResolver;
  resolveDirectPrivateAmounts?: TradeHistoryV2DirectPrivateAmountResolver;
  shouldContinue?: () => boolean;
}): Promise<Readonly<{
  state: TradeHistoryV2MaterializationState;
  page: TradeHistoryV2RangePage;
}>> => {
  assertCanonicalTradeHistoryV2LogRange(canonicalPage);
  assertTradeHistoryV2MaterializationState(previous);
  if (shouldContinue && !shouldContinue()) throw new Error('Trade-history materialization scope changed.');
  const scopeKey = buildTradeHistoryV2ScopeKey({ chainId, contractAddress });
  if (
    canonicalPage.scope.chainId !== chainId ||
    canonicalPage.scope.contractAddress !== getAddress(contractAddress).toLowerCase()
  ) {
    throw new Error('Canonical trade-history page belongs to another chain or contract.');
  }
  const currentRevision = previous.revisionsByScope[scopeKey] ?? 0;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision !== currentRevision) {
    throw new Error('Trade-history materialization used a stale revision.');
  }
  const fromBlock = BigInt(canonicalPage.range.fromBlock);
  const toBlock = BigInt(canonicalPage.range.toBlock);
  const normalizedViewer = viewer ? getAddress(viewer).toLowerCase() : undefined;

  const directOpeningsByOrderKey: Record<string, ParsedDirectTradeV2Opened> = Object.fromEntries(
    Object.entries(previous.directOpeningsByOrderKey).filter(([, opening]) => {
      const openingScope = buildTradeHistoryV2ScopeKey({
        chainId: opening.chainId,
        contractAddress: opening.contractAddress
      });
      const blockNumber = BigInt(opening.log.blockNumber);
      return openingScope !== scopeKey || blockNumber < fromBlock || blockNumber > toBlock;
    })
  );
  const directChatEntriesByPhysicalKey: Record<string, DirectTradeV2ChatEntry> = Object.fromEntries(
    Object.entries(previous.directChatEntriesByPhysicalKey).filter(([, entry]) => {
      const identity = entry.message.directTradeV2;
      if (!identity || !normalizedViewer || entry.viewer !== normalizedViewer) return true;
      const entryScope = buildTradeHistoryV2ScopeKey({
        chainId: identity.chainId,
        contractAddress: identity.contractAddress
      });
      const blockNumber = BigInt(identity.blockNumber);
      return entryScope !== scopeKey || blockNumber < fromBlock || blockNumber > toBlock;
    })
  );
  const lifecycleEventsByPhysicalKey: Record<string, TradeHistoryV2CanonicalLifecycleEvent> = Object.fromEntries(
    Object.entries(previous.lifecycleEventsByPhysicalKey).filter(([, event]) => {
      const eventScope = buildTradeHistoryV2ScopeKey({
        chainId: event.chainId,
        contractAddress: event.contractAddress
      });
      const blockNumber = BigInt(event.log.blockNumber);
      return eventScope !== scopeKey || blockNumber < fromBlock || blockNumber > toBlock;
    })
  );
  for (const event of canonicalPage.events) {
    if (event.kind !== 'direct-opened') continue;
    if (event.chainId !== chainId || event.contractAddress !== getAddress(contractAddress).toLowerCase()) {
      throw new Error('Canonical Direct opening belongs to another history scope.');
    }
    directOpeningsByOrderKey[directOrderKey(event)] = event;
  }
  for (const event of canonicalPage.events) {
    if (event.kind !== 'lifecycle' && event.kind !== 'direct-status' && event.kind !== 'direct-opened') continue;
    lifecycleEventsByPhysicalKey[lifecyclePhysicalKey(event)] = event;
  }

  if (normalizedViewer && canonicalPage.scope.protocol === 'direct-v2') {
    for (const entry of projectCanonicalDirectTradeV2ChatEntries({
      page: canonicalPage,
      viewerAddress: normalizedViewer
    })) {
      directChatEntriesByPhysicalKey[directChatPhysicalKey(entry)] = entry;
    }
  }

  const observations: TradeHistoryV2Observation[] = [];
  const executions = new Map<string, ParsedTradeHistoryV2Execution>();
  for (const event of canonicalPage.events) {
    if (event.kind !== 'execution') continue;
    observations.push(event.observation);
    executions.set(receiptJoinKey(event), event);
  }

  if (normalizedViewer && resolvePrivateReceiptAmounts) {
    for (const event of canonicalPage.events) {
      if (event.kind !== 'encrypted-receipt' || event.recipient !== normalizedViewer) continue;
      const marker = executions.get(receiptJoinKey(event));
      if (!marker) continue;
      const amounts = await resolvePrivateReceiptAmounts(event);
      if (shouldContinue && !shouldContinue()) throw new Error('Trade-history materialization scope changed.');
      if (!amounts) continue;
      observations.push(materializeTradeHistoryV2ParticipantReceipt({
        receipt: event,
        marker,
        decryptedAmounts: amounts
      }));
    }
  }

  for (const event of canonicalPage.events) {
    if (event.kind !== 'direct-status') continue;
    const opening = directOpeningsByOrderKey[buildTradeHistoryV2OrderKey({
      chainId: event.chainId,
      contractAddress: event.contractAddress,
      orderId: event.orderId
    })];
    if (!opening) {
      if (event.previousStatus === '1' && event.nextStatus === '2') {
        throw new Error('Canonical Direct acceptance is missing its replayed opening terms.');
      }
      continue;
    }
    if (event.previousStatus !== '1' || event.nextStatus !== '2') continue;
    let amounts: TradeHistoryV2Amounts | undefined;
    if (
      opening.amountMode === 'private' &&
      normalizedViewer &&
      (normalizedViewer === opening.maker || normalizedViewer === opening.taker) &&
      resolveDirectPrivateAmounts
    ) {
      amounts = await resolveDirectPrivateAmounts({ opened: opening, status: event, viewer: normalizedViewer });
      if (shouldContinue && !shouldContinue()) throw new Error('Trade-history materialization scope changed.');
    }
    observations.push(materializeDirectTradeV2Acceptance({
      opened: opening,
      status: event,
      recipient: amounts ? normalizedViewer : undefined,
      decryptedAmounts: amounts
    }));
  }

  if (shouldContinue && !shouldContinue()) throw new Error('Trade-history materialization scope changed.');
  return Object.freeze({
    state: registerMaterializationState({
      directOpeningsByOrderKey: Object.freeze(directOpeningsByOrderKey),
      directChatEntriesByPhysicalKey: Object.freeze(directChatEntriesByPhysicalKey),
      lifecycleEventsByPhysicalKey: Object.freeze(lifecycleEventsByPhysicalKey),
      revisionsByScope: Object.freeze({
        ...previous.revisionsByScope,
        [scopeKey]: currentRevision + 1
      })
    }),
    page: Object.freeze({
      schema: 1,
      chainId,
      contractAddress,
      fromBlock: canonicalPage.range.fromBlock,
      toBlock: canonicalPage.range.toBlock,
      fromBlockHash: canonicalPage.range.fromBlockHash,
      toBlockHash: canonicalPage.range.toBlockHash,
      observations: Object.freeze(observations)
    })
  });
};
