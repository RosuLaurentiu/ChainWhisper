import {
  buildTradeSnapshotKey,
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeSnapshot
} from '../../../lib/appShared/core';
import { mergeWalletAccountMatches } from '../../../lib/walletAccountScope';
import { hasHydratedDirectTradeTerms } from '../../../lib/p2pTradeView';

const getSnapshotKey = (snapshot: Pick<TradeSnapshot, 'tradeId' | 'escrowContract'>): string =>
  buildTradeSnapshotKey(snapshot.tradeId, snapshot.escrowContract);

const hasEntries = <T,>(value?: T[]): boolean => Boolean(value?.length);

type RecurringExecution = NonNullable<NonNullable<TradeSnapshot['recurringOrder']>['privateExecutions']>[number];
type WalletFillEvent = NonNullable<TradeSnapshot['walletFillEvents']>[number];
type PrivateFillReceipt = NonNullable<TradeSnapshot['privateFillReceipts']>[number];

const getRecurringExecutionKey = (execution: RecurringExecution): string =>
  `${execution.fillIndex}:${normalizeWalletKey(execution.filler)}`;

const getWalletFillEventKey = (event: WalletFillEvent): string =>
  event.txHash
    ? `${event.txHash.trim().toLowerCase()}:${event.logIndex ?? event.fillIndex}:${normalizeWalletKey(event.filler)}`
    : `${event.fillIndex}:${normalizeWalletKey(event.filler)}`;

const getPrivateFillReceiptKey = (receipt: PrivateFillReceipt): string =>
  receipt.txHash
    ? `${receipt.txHash.trim().toLowerCase()}:${receipt.fillIndex}:${normalizeWalletKey(receipt.filler)}`
    : `${receipt.fillIndex}:${normalizeWalletKey(receipt.filler)}`;

const sortFillEvents = <T extends { fillIndex: number; blockNumber?: number; logIndex?: number }>(items: T[]): T[] =>
  [...items].sort((left, right) =>
    (left.blockNumber ?? 0) - (right.blockNumber ?? 0) ||
    (left.logIndex ?? 0) - (right.logIndex ?? 0) ||
    left.fillIndex - right.fillIndex
  );

const mergeWalletFillEvents = (
  incoming?: WalletFillEvent[],
  existing?: WalletFillEvent[]
): WalletFillEvent[] | undefined => {
  if (!hasEntries(incoming) && !hasEntries(existing)) {
    return undefined;
  }

  const byKey = new Map<string, WalletFillEvent>();
  for (const event of existing ?? []) {
    byKey.set(getWalletFillEventKey(event), event);
  }
  for (const event of incoming ?? []) {
    const key = getWalletFillEventKey(event);
    byKey.set(key, {
      ...byKey.get(key),
      ...event
    });
  }

  return sortFillEvents(Array.from(byKey.values()));
};

const mergePrivateFillReceipts = (
  incoming?: PrivateFillReceipt[],
  existing?: PrivateFillReceipt[]
): PrivateFillReceipt[] | undefined => {
  if (!hasEntries(incoming) && !hasEntries(existing)) {
    return undefined;
  }

  const byKey = new Map<string, PrivateFillReceipt>();
  for (const receipt of existing ?? []) {
    byKey.set(getPrivateFillReceiptKey(receipt), receipt);
  }
  for (const receipt of incoming ?? []) {
    const key = getPrivateFillReceiptKey(receipt);
    byKey.set(key, {
      ...byKey.get(key),
      ...receipt
    });
  }

  return sortFillEvents(Array.from(byKey.values()));
};

const mergeRecurringExecutions = (
  incoming?: RecurringExecution[],
  existing?: RecurringExecution[]
): RecurringExecution[] | undefined => {
  if (!hasEntries(incoming) && !hasEntries(existing)) {
    return undefined;
  }

  const byKey = new Map<string, RecurringExecution>();
  for (const execution of existing ?? []) {
    byKey.set(getRecurringExecutionKey(execution), execution);
  }
  for (const execution of incoming ?? []) {
    const key = getRecurringExecutionKey(execution);
    byKey.set(key, {
      ...byKey.get(key),
      ...execution
    });
  }

  return Array.from(byKey.values()).sort((left, right) => left.fillIndex - right.fillIndex);
};

const isDirectEscrowSnapshot = (snapshot: Pick<TradeSnapshot, 'escrowContract'>): boolean =>
  snapshot.escrowContract?.toLowerCase() === DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase();

const normalizeWalletKey = (walletKey?: string): string => walletKey?.trim().toLowerCase() ?? '';

const stripWalletScopedTradeSnapshot = (snapshot: TradeSnapshot): TradeSnapshot => {
  const stripped: TradeSnapshot = {
    ...snapshot,
    offer: isDirectEscrowSnapshot(snapshot) ? { ...snapshot.offer, amount: '0' } : snapshot.offer,
    request: isDirectEscrowSnapshot(snapshot) ? { ...snapshot.request, amount: '0' } : snapshot.request,
    fillState: isDirectEscrowSnapshot(snapshot) ? undefined : snapshot.fillState,
    hiddenLiquidity: isDirectEscrowSnapshot(snapshot) ? true : snapshot.hiddenLiquidity,
    makerPrivateProgress: undefined,
    privateFillReceipts: undefined,
    walletFillEvents: undefined,
    walletFillState: undefined,
    walletHasFill: undefined
  };

  if (snapshot.recurringOrder) {
    stripped.recurringOrder = {
      ...snapshot.recurringOrder,
      makerPrivateInventory: undefined,
      privateExecutions: undefined,
      publicExecutions: undefined
    };
  }

  return stripped;
};

type WalletScopedTradeFilterOptions = {
  preserveAuthorizedDirectTerms?: boolean;
};

const filterWalletScopedTradeSnapshot = (
  snapshot: TradeSnapshot,
  walletKey?: string,
  options: WalletScopedTradeFilterOptions = {}
): TradeSnapshot => {
  const normalizedWalletKey = normalizeWalletKey(walletKey);
  if (!normalizedWalletKey) {
    return stripWalletScopedTradeSnapshot(snapshot);
  }

  const makerKey = snapshot.maker.toLowerCase();
  const takerKey = snapshot.taker.toLowerCase();
  const isMaker = makerKey === normalizedWalletKey;
  const isDirectParticipant = isDirectEscrowSnapshot(snapshot) && (isMaker || takerKey === normalizedWalletKey);
  const canReadDirectTerms = isDirectParticipant || Boolean(options.preserveAuthorizedDirectTerms);
  const privateFillReceipts = isMaker
    ? snapshot.privateFillReceipts
    : (snapshot.privateFillReceipts ?? []).filter((receipt) => receipt.filler?.toLowerCase() === normalizedWalletKey);
  const hasPrivateFillReceipts = hasEntries(privateFillReceipts);
  const walletFillEvents = isMaker
    ? snapshot.walletFillEvents
    : (snapshot.walletFillEvents ?? []).filter((event) => event.filler?.toLowerCase() === normalizedWalletKey);
  const hasWalletFillEvents = hasEntries(walletFillEvents);
  const walletFillState = !isMaker && snapshot.walletHasFill ? snapshot.walletFillState : undefined;
  const walletHasFill = isMaker
    ? snapshot.walletHasFill || hasPrivateFillReceipts || hasWalletFillEvents
      ? true
      : undefined
    : hasPrivateFillReceipts || hasWalletFillEvents || (snapshot.walletHasFill && walletFillState)
      ? true
      : undefined;

  const filtered: TradeSnapshot = {
    ...snapshot,
    offer: isDirectEscrowSnapshot(snapshot) && !canReadDirectTerms ? { ...snapshot.offer, amount: '0' } : snapshot.offer,
    request: isDirectEscrowSnapshot(snapshot) && !canReadDirectTerms ? { ...snapshot.request, amount: '0' } : snapshot.request,
    fillState: isDirectEscrowSnapshot(snapshot) && !canReadDirectTerms ? undefined : snapshot.fillState,
    hiddenLiquidity: isDirectEscrowSnapshot(snapshot) && !canReadDirectTerms ? true : snapshot.hiddenLiquidity,
    makerPrivateProgress: isMaker ? snapshot.makerPrivateProgress : undefined,
    privateFillReceipts: hasPrivateFillReceipts ? privateFillReceipts : undefined,
    walletFillEvents: hasWalletFillEvents ? walletFillEvents : undefined,
    walletFillState,
    walletHasFill
  };

  if (snapshot.recurringOrder) {
    const privateExecutions = isMaker
      ? snapshot.recurringOrder.privateExecutions
      : (snapshot.recurringOrder.privateExecutions ?? []).filter(
          (execution) => execution.filler?.toLowerCase() === normalizedWalletKey
        );
    const publicExecutions = isMaker
      ? snapshot.recurringOrder.publicExecutions
      : (snapshot.recurringOrder.publicExecutions ?? []).filter(
          (execution) => execution.filler?.toLowerCase() === normalizedWalletKey
        );
    filtered.recurringOrder = {
      ...snapshot.recurringOrder,
      makerPrivateInventory: isMaker ? snapshot.recurringOrder.makerPrivateInventory : undefined,
      privateExecutions: hasEntries(privateExecutions) ? privateExecutions : undefined,
      publicExecutions: hasEntries(publicExecutions) ? publicExecutions : undefined
    };
    if (!isMaker && (snapshot.walletHasFill || hasEntries(privateExecutions) || hasEntries(publicExecutions))) {
      filtered.walletHasFill = true;
    }
  }

  return filtered;
};

export const mergeTradeSnapshotEnrichment = (
  incoming: TradeSnapshot,
  existing?: TradeSnapshot | null,
  walletKey?: string,
  options: WalletScopedTradeFilterOptions = {}
): TradeSnapshot => {
  const shouldApplyWalletScope = walletKey !== undefined;
  const walletScopedIncoming = shouldApplyWalletScope
    ? filterWalletScopedTradeSnapshot(incoming, walletKey, options)
    : incoming;
  const walletScopedExisting =
    existing && shouldApplyWalletScope
      ? filterWalletScopedTradeSnapshot(existing, walletKey, options)
      : existing;

  if (!walletScopedExisting || getSnapshotKey(walletScopedExisting) !== getSnapshotKey(walletScopedIncoming)) {
    return mergeWalletAccountMatches(walletScopedExisting, walletScopedIncoming);
  }

  const preserveDirectTerms =
    isDirectEscrowSnapshot(walletScopedIncoming) &&
    hasHydratedDirectTradeTerms(walletScopedExisting) &&
    !hasHydratedDirectTradeTerms(walletScopedIncoming);
  const merged: TradeSnapshot = {
    ...walletScopedIncoming,
    ...(preserveDirectTerms
      ? {
          offer: walletScopedExisting.offer,
          request: walletScopedExisting.request,
          fillState: walletScopedExisting.fillState ?? walletScopedIncoming.fillState,
          hiddenLiquidity: walletScopedExisting.hiddenLiquidity
        }
      : {}),
    walletHasFill: Boolean(walletScopedIncoming.walletHasFill || walletScopedExisting.walletHasFill) || undefined,
    walletFillState: walletScopedIncoming.walletFillState ?? walletScopedExisting.walletFillState,
    walletFillEvents: mergeWalletFillEvents(walletScopedIncoming.walletFillEvents, walletScopedExisting.walletFillEvents),
    makerPrivateProgress: walletScopedIncoming.makerPrivateProgress ?? walletScopedExisting.makerPrivateProgress,
    privateFillReceipts: mergePrivateFillReceipts(
      walletScopedIncoming.privateFillReceipts,
      walletScopedExisting.privateFillReceipts
    )
  };

  if (walletScopedIncoming.recurringOrder && walletScopedExisting.recurringOrder) {
    const incomingPrivateInventory = walletScopedIncoming.recurringOrder.makerPrivateInventory;
    const existingPrivateInventory = walletScopedExisting.recurringOrder.makerPrivateInventory;
    merged.recurringOrder = {
      ...walletScopedIncoming.recurringOrder,
      makerPrivateInventory:
        incomingPrivateInventory || existingPrivateInventory
          ? {
              ...existingPrivateInventory,
              ...incomingPrivateInventory
            }
          : undefined,
      privateExecutions:
        mergeRecurringExecutions(
          walletScopedIncoming.recurringOrder.privateExecutions,
          walletScopedExisting.recurringOrder.privateExecutions
        ),
      publicExecutions:
        mergeRecurringExecutions(
          walletScopedIncoming.recurringOrder.publicExecutions,
          walletScopedExisting.recurringOrder.publicExecutions
        )
    };
  }

  return mergeWalletAccountMatches(walletScopedExisting, merged);
};

export const __mergeTradeSnapshotEnrichmentForTest = mergeTradeSnapshotEnrichment;
export const __filterWalletScopedTradeSnapshotForTest = filterWalletScopedTradeSnapshot;
export const __stripWalletScopedTradeSnapshotForTest = stripWalletScopedTradeSnapshot;
