import {
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetPayload,
  type TradeSnapshot
} from './appShared';
import { buildTradeSnapshotKey } from './appShared/core';
import { formatTradeContractIdLabel, getTradeTermsVisibility, hasHydratedDirectTradeTerms } from './p2pTradeView';
import { isZeroTradeTakerAddress } from './tradePerspective';
import type { TradeHistoryV2ExecutionRow } from './tradeHistoryV2Ledger';
import type { TradeHistoryV2CanonicalLifecycleEvent } from './tradeHistoryV2Materialize';

export type TradeTransactionHistoryRole = 'maker' | 'taker' | 'filler';
export type TradeTransactionHistorySource = 'standard' | 'private' | 'direct' | 'recurring';
export type TradeTransactionAmountVisibility = 'public' | 'private-revealed' | 'private-hidden';
export type TradeLifecycleHistoryAction =
  | 'created'
  | 'edited'
  | 'replaced'
  | 'accepted'
  | 'cancelled'
  | 'declined'
  | 'expired'
  | 'paused'
  | 'resumed'
  | 'settled';

export type TradeTransactionAsset = TradeAssetPayload & {
  visible: boolean;
};

export type TradeTransactionFlowAction = 'bought' | 'sold';

export type TradeTransactionTokenFlow = {
  action: TradeTransactionFlowAction;
  asset: TradeTransactionAsset;
};

export type TradeTransactionHistoryRow = {
  key: string;
  contractAddress: string;
  localId: number;
  role: TradeTransactionHistoryRole;
  sourceKind: TradeTransactionHistorySource;
  counterparty: string;
  bought: TradeTransactionAsset;
  sold: TradeTransactionAsset;
  tokenFlows: TradeTransactionTokenFlow[];
  amountVisibility: TradeTransactionAmountVisibility;
  sequence?: number;
  txHash?: string;
  blockNumber?: number;
  timestamp?: number;
};

export type TradeLifecycleHistoryRow = {
  key: string;
  contractAddress: string;
  localId: number;
  sourceKind: TradeTransactionHistorySource;
  action: TradeLifecycleHistoryAction;
  label: string;
  detail: string;
  actor: string;
  relatedTradeId?: number;
  returnedAssets?: TradeTransactionAsset[];
  txHash?: string;
  blockNumber?: number;
  timestamp?: number;
};

export const aggregateVisibleTradeTransactionHistoryRows = (
  rows: readonly TradeTransactionHistoryRow[]
): TradeTransactionHistoryRow | undefined => {
  const first = rows[0];
  if (!first) return undefined;
  const boughtKey = getAssetKey(first.bought);
  const soldKey = getAssetKey(first.sold);
  let boughtAmount = 0n;
  let soldAmount = 0n;

  for (const row of rows) {
    if (
      row.contractAddress.toLowerCase() !== first.contractAddress.toLowerCase() ||
      row.localId !== first.localId ||
      row.sourceKind !== first.sourceKind ||
      row.amountVisibility === 'private-hidden' ||
      !row.bought.visible ||
      !row.sold.visible ||
      getAssetKey(row.bought) !== boughtKey ||
      getAssetKey(row.sold) !== soldKey ||
      !/^\d+$/.test(row.bought.amount) ||
      !/^\d+$/.test(row.sold.amount)
    ) {
      return undefined;
    }
    boughtAmount += BigInt(row.bought.amount);
    soldAmount += BigInt(row.sold.amount);
  }

  const bought = { ...first.bought, amount: boughtAmount.toString() };
  const sold = { ...first.sold, amount: soldAmount.toString() };
  return {
    ...first,
    key: `${first.contractAddress.toLowerCase()}:${first.localId}:exact-total`,
    bought,
    sold,
    tokenFlows: buildTokenFlows([first.sold, first.bought], bought, sold),
    sequence: undefined,
    txHash: undefined,
    blockNumber: undefined,
    timestamp: undefined
  };
};

const normalizeAddress = (value?: string | null): string => value?.trim().toLowerCase() ?? '';

const isPositiveAmount = (value?: string): boolean => /^\d+$/.test(value ?? '') && BigInt(value ?? '0') > 0n;

const withAmount = (asset: TradeAssetPayload, amount: string | undefined, visible: boolean): TradeTransactionAsset => ({
  ...asset,
  amount: visible && amount && /^\d+$/.test(amount) ? amount : asset.amount,
  visible
});

const getAssetKey = (asset: TradeAssetPayload): string =>
  `${asset.kind}:${normalizeAddress(asset.tokenAddress)}:${asset.symbol.trim().toLowerCase()}`;

const buildTokenFlows = (
  orderedAssets: TradeAssetPayload[],
  bought: TradeTransactionAsset,
  sold: TradeTransactionAsset
): TradeTransactionTokenFlow[] => {
  const flowByAssetKey = new Map<string, TradeTransactionTokenFlow>([
    [getAssetKey(bought), { action: 'bought', asset: bought }],
    [getAssetKey(sold), { action: 'sold', asset: sold }]
  ]);
  const seen = new Set<string>();
  const orderedFlows: TradeTransactionTokenFlow[] = [];

  for (const asset of orderedAssets) {
    const assetKey = getAssetKey(asset);
    const flow = flowByAssetKey.get(assetKey);
    if (!flow || seen.has(assetKey)) continue;
    orderedFlows.push(flow);
    seen.add(assetKey);
  }

  for (const flow of [
    { action: 'bought', asset: bought } as const,
    { action: 'sold', asset: sold } as const
  ]) {
    const assetKey = getAssetKey(flow.asset);
    if (seen.has(assetKey)) continue;
    orderedFlows.push(flow);
    seen.add(assetKey);
  }

  return orderedFlows;
};

const resolveTradeSourceKind = (trade: TradeSnapshot): TradeTransactionHistorySource => {
  if (trade.recurringOrder) return 'recurring';
  if (getTradeTermsVisibility(trade) === 'hidden-liquidity') return 'private';
  if (trade.escrowContract && normalizeAddress(trade.escrowContract) !== normalizeAddress(TRADE_ESCROW_CONTRACT_ADDRESS)) {
    return 'direct';
  }
  return 'standard';
};

export const buildTradeLifecycleHistoryRows = (
  trade: TradeSnapshot,
  canonicalV2Events?: readonly TradeHistoryV2CanonicalLifecycleEvent[]
): TradeLifecycleHistoryRow[] => {
  const contractAddress = trade.escrowContract || TRADE_ESCROW_CONTRACT_ADDRESS;
  const snapshotKey = buildTradeSnapshotKey(trade.tradeId, contractAddress);
  const recurring = trade.recurringOrder;
  const sourceKind = resolveTradeSourceKind(trade);
  const localId = recurring?.orderId ?? trade.tradeId;
  const subjectLabel = formatTradeContractIdLabel(trade);
  const formatRelatedTradeLabel = (tradeId: number): string =>
    formatTradeContractIdLabel({ tradeId, escrowContract: trade.escrowContract, v2: trade.v2 });
  const formatCanonicalRelatedTradeLabel = (tradeId: string): string => {
    const parsed = BigInt(tradeId);
    return parsed <= BigInt(Number.MAX_SAFE_INTEGER)
      ? formatRelatedTradeLabel(Number(parsed))
      : `Order #${tradeId}`;
  };
  const rows: TradeLifecycleHistoryRow[] = [
    {
      key: `${snapshotKey}:lifecycle:created`,
      contractAddress,
      localId,
      sourceKind,
      action: 'created',
      label: 'Created',
      detail: `${subjectLabel} opened`,
      actor: trade.maker,
      ...(trade.createdAt ? { timestamp: trade.createdAt } : {})
    }
  ];

  if (!recurring && trade.replacesTradeId) {
    rows.push({
      key: `${snapshotKey}:lifecycle:edited-from:${trade.replacesTradeId}`,
      contractAddress,
      localId,
      sourceKind,
      action: 'edited',
      label: 'Edited',
      detail: `Replaces ${formatRelatedTradeLabel(trade.replacesTradeId)}`,
      actor: trade.maker,
      relatedTradeId: trade.replacesTradeId,
      ...(trade.createdAt ? { timestamp: trade.createdAt } : {})
    });
  }

  if (!recurring && trade.replacementTradeId) {
    rows.push({
      key: `${snapshotKey}:lifecycle:replaced-by:${trade.replacementTradeId}`,
      contractAddress,
      localId,
      sourceKind,
      action: 'replaced',
      label: 'Edited',
      detail: `Replaced by ${formatRelatedTradeLabel(trade.replacementTradeId)}`,
      actor: trade.maker,
      relatedTradeId: trade.replacementTradeId
    });
  }

  const linkedCounterId =
    !recurring && trade.counterParentTradeId && trade.counterParentTradeId > trade.tradeId
      ? trade.counterParentTradeId
      : undefined;
  if (!recurring && trade.status === 'accepted' && linkedCounterId) {
    rows.push({
      key: `${snapshotKey}:lifecycle:counter-accepted:${linkedCounterId}`,
      contractAddress,
      localId,
      sourceKind,
      action: 'accepted',
      label: 'Counter accepted',
      detail: `${formatRelatedTradeLabel(linkedCounterId)} settled this parent offer`,
      actor: trade.taker,
      relatedTradeId: linkedCounterId,
      ...(trade.acceptedTxHash ? { txHash: trade.acceptedTxHash } : {})
    });
  }

  if (!recurring && trade.status === 'accepted' && !linkedCounterId) {
    rows.push({
      key: `${snapshotKey}:lifecycle:accepted`,
      contractAddress,
      localId,
      sourceKind,
      action: 'accepted',
      label: trade.counterParentTradeId ? 'Counter accepted' : 'Accepted',
      detail: trade.counterParentTradeId
        ? `${subjectLabel} accepted as counter to ${formatRelatedTradeLabel(trade.counterParentTradeId)}`
        : `${subjectLabel} accepted`,
      actor: trade.taker,
      ...(trade.counterParentTradeId ? { relatedTradeId: trade.counterParentTradeId } : {}),
      ...(trade.acceptedTxHash ? { txHash: trade.acceptedTxHash } : {})
    });
  }

  if (recurring?.recurringStatus === 'cancelled') {
    rows.push({
      key: `${snapshotKey}:lifecycle:cancelled`,
      contractAddress,
      localId,
      sourceKind,
      action: 'cancelled',
      label: 'Closed',
      detail: `${subjectLabel} closed`,
      actor: trade.maker
    });
  } else if (!recurring && trade.status === 'cancelled') {
    rows.push({
      key: `${snapshotKey}:lifecycle:cancelled`,
      contractAddress,
      localId,
      sourceKind,
      action: 'cancelled',
      label: 'Cancelled',
      detail: `${subjectLabel} cancelled`,
      actor: trade.maker
    });
  }

  const identity = trade.v2 ?? trade.recurringOrder?.v2;
  if (!canonicalV2Events || !identity) return rows;
  const canonicalEvents = canonicalV2Events.filter((event) =>
    event.protocol === identity.protocol &&
    event.chainId === identity.chainId &&
    event.contractAddress === identity.contractAddress.toLowerCase() &&
    (
      event.orderId === String(localId) ||
      (event.kind === 'lifecycle' &&
        event.lifecycleKind === 'replacement' &&
        event.replacementOrderId === String(localId))
    )
  );
  const canonicalRows = canonicalEvents.map((event): TradeLifecycleHistoryRow | null => {
    let action: TradeLifecycleHistoryAction;
    let label: string;
    let detail: string;
    let actor = event.maker ?? trade.maker;
    let relatedOrderId: string | undefined;
    let returnedAssets: TradeTransactionAsset[] | undefined;
    let timestamp: number | undefined;

    if (event.kind === 'direct-opened') {
      action = 'created';
      label = 'Created';
      detail = `${subjectLabel} opened`;
      timestamp = Number(event.createdAt);
    } else if (event.kind === 'lifecycle' && event.lifecycleKind === 'opened') {
      action = 'created';
      label = 'Created';
      detail = `${subjectLabel} opened`;
      timestamp = event.createdAt === undefined ? undefined : Number(event.createdAt);
    } else if (event.kind === 'lifecycle' && event.lifecycleKind === 'edited') {
      action = 'edited';
      label = 'Edited';
      detail = event.protocol === 'private-recurring-v2' && event.liquidityChanged
        ? `${subjectLabel} updated its private terms and liquidity`
        : `${subjectLabel} updated`;
    } else if (event.kind === 'lifecycle' && event.lifecycleKind === 'replacement') {
      if (event.replacementOrderId !== String(localId)) return null;
      action = 'edited';
      label = 'Edited';
      relatedOrderId = event.orderId;
      detail = `Replaces ${formatCanonicalRelatedTradeLabel(event.orderId)}`;
    } else if (event.kind === 'lifecycle' && event.lifecycleKind === 'settlement') {
      action = 'settled';
      label = 'Inventory returned';
      detail = event.settledAmounts
        ? `${subjectLabel} returned its remaining public inventory`
        : `${subjectLabel} returned its remaining private inventory`;
      if (trade.recurringOrder) {
        returnedAssets = event.settledAmounts
          ? [
              withAmount(trade.recurringOrder.baseAsset, event.settledAmounts.baseAmount, true),
              withAmount(trade.recurringOrder.quoteAsset, event.settledAmounts.quoteAmount, true)
            ]
          : [
              withAmount(trade.recurringOrder.baseAsset, undefined, false),
              withAmount(trade.recurringOrder.quoteAsset, undefined, false)
            ];
      }
    } else if (event.kind === 'direct-status' || (event.kind === 'lifecycle' && event.lifecycleKind === 'status')) {
      const nextStatus = event.nextStatus;
      actor = event.actor ?? event.maker ?? trade.maker;
      relatedOrderId = event.relatedOrderId;
      const recurringStatus = identity.protocol === 'recurring-v2' || identity.protocol === 'private-recurring-v2';
      if (recurringStatus) {
        if (nextStatus === '1') {
          action = 'resumed';
          label = 'Resumed';
          detail = `${subjectLabel} resumed`;
        } else if (nextStatus === '2') {
          action = 'paused';
          label = 'Paused';
          detail = `${subjectLabel} paused`;
        } else if (nextStatus === '3') {
          action = 'cancelled';
          label = 'Closed';
          detail = `${subjectLabel} closed`;
        } else if (nextStatus === '4') {
          action = 'expired';
          label = 'Expired';
          detail = `${subjectLabel} expired`;
        } else {
          return null;
        }
      } else if (identity.protocol === 'direct-v2') {
        if (nextStatus === '2') {
          action = 'accepted';
          label = trade.counterParentTradeId ? 'Counter accepted' : 'Accepted';
          detail = trade.counterParentTradeId
            ? `${subjectLabel} accepted as counter to ${formatRelatedTradeLabel(trade.counterParentTradeId)}`
            : `${subjectLabel} accepted`;
        } else if (nextStatus === '3') {
          action = 'cancelled';
          label = 'Cancelled';
          detail = `${subjectLabel} cancelled`;
        } else if (nextStatus === '4') {
          action = 'declined';
          label = 'Declined';
          detail = `${subjectLabel} declined`;
        } else if (nextStatus === '5') {
          action = 'expired';
          label = 'Expired';
          detail = `${subjectLabel} expired`;
        } else if (nextStatus === '6' || nextStatus === '7') {
          action = 'replaced';
          label = 'Replaced';
          detail = relatedOrderId && relatedOrderId !== '0'
            ? `Replaced by ${formatCanonicalRelatedTradeLabel(relatedOrderId)}`
            : `${subjectLabel} replaced`;
        } else {
          return null;
        }
      } else if (nextStatus === '2') {
        action = 'accepted';
        label = 'Filled';
        detail = `${subjectLabel} filled`;
      } else if (nextStatus === '3') {
        action = 'cancelled';
        label = 'Cancelled';
        detail = `${subjectLabel} cancelled`;
      } else if (nextStatus === '4') {
        action = 'expired';
        label = 'Expired';
        detail = `${subjectLabel} expired`;
      } else if (nextStatus === '5') {
        action = 'replaced';
        label = 'Replaced';
        detail = relatedOrderId && relatedOrderId !== '0'
          ? `Replaced by ${formatCanonicalRelatedTradeLabel(relatedOrderId)}`
          : `${subjectLabel} replaced`;
      } else {
        return null;
      }
    } else {
      return null;
    }

    const blockNumber = BigInt(event.log.blockNumber);
    const relatedId = relatedOrderId && relatedOrderId !== '0' ? BigInt(relatedOrderId) : undefined;
    return {
      key: `${snapshotKey}:canonical:${event.log.blockHash}:${event.log.transactionHash}:${event.log.logIndex}`,
      contractAddress,
      localId,
      sourceKind,
      action,
      label,
      detail,
      actor,
      ...(returnedAssets ? { returnedAssets } : {}),
      ...(timestamp !== undefined && Number.isSafeInteger(timestamp) ? { timestamp } : {}),
      ...(relatedId !== undefined && relatedId <= BigInt(Number.MAX_SAFE_INTEGER)
        ? { relatedTradeId: Number(relatedId) }
        : {}),
      txHash: event.log.transactionHash,
      ...(blockNumber <= BigInt(Number.MAX_SAFE_INTEGER) ? { blockNumber: Number(blockNumber) } : {})
    };
  }).filter((row): row is TradeLifecycleHistoryRow => Boolean(row));

  return [
    ...canonicalRows
  ];
};

const appendRecurringRows = (
  rows: TradeTransactionHistoryRow[],
  trade: TradeSnapshot,
  walletKey: string,
  contractAddress: string
) => {
  const recurring = trade.recurringOrder;
  if (!recurring) return;

  const makerKey = normalizeAddress(trade.maker);
  const isMaker = walletKey === makerKey;
  type RecurringExecution = NonNullable<NonNullable<TradeSnapshot['recurringOrder']>['publicExecutions']>[number];
  type RecurringHistoryExecution = RecurringExecution & { historySource: 'private' | 'public' };
  const executionsByFill = new Map<string, RecurringHistoryExecution>();
  for (const execution of recurring.publicExecutions ?? []) {
    executionsByFill.set(`${execution.fillIndex}:${normalizeAddress(execution.filler)}`, {
      ...execution,
      historySource: 'public'
    });
  }
  for (const execution of recurring.privateExecutions ?? []) {
    const fillKey = `${execution.fillIndex}:${normalizeAddress(execution.filler)}`;
    executionsByFill.set(fillKey, {
      ...executionsByFill.get(fillKey),
      ...execution,
      historySource: 'private'
    });
  }
  const executions = Array.from(executionsByFill.values());

  for (const execution of executions) {
    const fillerKey = normalizeAddress(execution.filler);
    const isFiller = walletKey === fillerKey;
    if (!isMaker && !isFiller) continue;

    const baseAmount = isPositiveAmount(execution.baseAmount)
      ? execution.baseAmount
      : undefined;
    const quoteAmount = isPositiveAmount(execution.quoteAmount)
      ? execution.quoteAmount
      : undefined;
    const fillerBuysBase = execution.side === 'buy';
    const walletBuysBase = isMaker ? !fillerBuysBase : fillerBuysBase;
    const baseVisible = isPositiveAmount(baseAmount);
    const quoteVisible = isPositiveAmount(quoteAmount);
    const amountVisibility: TradeTransactionAmountVisibility =
      recurring.mode === 'public' ? 'public' : baseVisible && quoteVisible ? 'private-revealed' : 'private-hidden';
    const bought = walletBuysBase
      ? withAmount(recurring.baseAsset, baseAmount, baseVisible)
      : withAmount(recurring.quoteAsset, quoteAmount, quoteVisible);
    const sold = walletBuysBase
      ? withAmount(recurring.quoteAsset, quoteAmount, quoteVisible)
      : withAmount(recurring.baseAsset, baseAmount, baseVisible);

    rows.push({
      key: `${buildTradeSnapshotKey(trade.tradeId, contractAddress)}:recurring:${execution.fillIndex}:${isMaker ? 'maker' : `filler:${fillerKey}`}`,
      contractAddress,
      localId: recurring.orderId,
      role: isMaker ? 'maker' : 'filler',
      sourceKind: 'recurring',
      counterparty: isMaker ? execution.filler : trade.maker,
      bought,
      sold,
      tokenFlows: buildTokenFlows([recurring.baseAsset, recurring.quoteAsset], bought, sold),
      amountVisibility,
      sequence: execution.fillIndex,
      ...(execution.txHash ? { txHash: execution.txHash } : {}),
      ...(execution.blockNumber !== undefined ? { blockNumber: execution.blockNumber } : {})
    });
  }
};

const buildCanonicalV2Rows = (
  trade: TradeSnapshot,
  walletKey: string,
  canonicalRows: readonly TradeHistoryV2ExecutionRow[]
): TradeTransactionHistoryRow[] | null => {
  const identity = trade.v2 ?? trade.recurringOrder?.v2;
  if (!identity) return null;

  const contractAddress = identity.contractAddress.toLowerCase();
  const localId = String(trade.recurringOrder?.orderId ?? trade.tradeId);
  const matchingRows = canonicalRows.filter((row) =>
    row.protocol === identity.protocol &&
    row.order.chainId === identity.chainId &&
    row.order.contractAddress.toLowerCase() === contractAddress &&
    row.order.orderId === localId &&
    (row.maker === walletKey || row.participant === walletKey)
  );

  return matchingRows.map((row) => {
    const isMaker = row.maker === walletKey;
    const visible = row.amountState === 'available';
    const sourceKind: TradeTransactionHistorySource =
      row.protocol === 'standard-v2'
        ? 'standard'
        : row.protocol === 'private-v2'
          ? 'private'
          : row.protocol === 'direct-v2'
            ? 'direct'
            : 'recurring';
    const amountVisibility: TradeTransactionAmountVisibility = visible
      ? sourceKind === 'standard' || getTradeTermsVisibility(trade) === 'public'
        ? 'public'
        : 'private-revealed'
      : 'private-hidden';

    let bought: TradeTransactionAsset;
    let sold: TradeTransactionAsset;
    let orderedAssets: TradeAssetPayload[];
    if (trade.recurringOrder) {
      const { baseAsset, quoteAsset } = trade.recurringOrder;
      const walletBuysBase = isMaker ? row.side !== 'buy' : row.side === 'buy';
      bought = walletBuysBase
        ? withAmount(baseAsset, row.amounts.baseAmount, visible)
        : withAmount(quoteAsset, row.amounts.quoteAmount, visible);
      sold = walletBuysBase
        ? withAmount(quoteAsset, row.amounts.quoteAmount, visible)
        : withAmount(baseAsset, row.amounts.baseAmount, visible);
      orderedAssets = [baseAsset, quoteAsset];
    } else {
      bought = isMaker
        ? withAmount(trade.request, row.amounts.requestAmount, visible)
        : withAmount(trade.offer, row.amounts.offerAmount, visible);
      sold = isMaker
        ? withAmount(trade.offer, row.amounts.offerAmount, visible)
        : withAmount(trade.request, row.amounts.requestAmount, visible);
      orderedAssets = [trade.offer, trade.request];
    }

    const sequence = BigInt(row.sequence);
    const blockNumber = BigInt(row.log.blockNumber);
    return {
      key: row.key,
      contractAddress: identity.contractAddress,
      localId: Number(localId),
      role: isMaker ? 'maker' : row.protocol === 'direct-v2' ? 'taker' : 'filler',
      sourceKind,
      counterparty: isMaker ? row.participant : row.maker,
      bought,
      sold,
      tokenFlows: buildTokenFlows(orderedAssets, bought, sold),
      amountVisibility,
      ...(sequence <= BigInt(Number.MAX_SAFE_INTEGER) ? { sequence: Number(sequence) } : {}),
      txHash: row.log.transactionHash,
      ...(blockNumber <= BigInt(Number.MAX_SAFE_INTEGER) ? { blockNumber: Number(blockNumber) } : {})
    };
  });
};

export const buildTradeTransactionHistoryRows = (
  trades: TradeSnapshot[],
  walletAddress: string,
  canonicalV2Rows?: readonly TradeHistoryV2ExecutionRow[]
): TradeTransactionHistoryRow[] => {
  const walletKey = normalizeAddress(walletAddress);
  if (!walletKey) return [];

  const rows: TradeTransactionHistoryRow[] = [];

  for (const trade of trades) {
    const contractAddress = trade.escrowContract || TRADE_ESCROW_CONTRACT_ADDRESS;
    if (canonicalV2Rows) {
      const canonicalRows = buildCanonicalV2Rows(trade, walletKey, canonicalV2Rows);
      if (canonicalRows) {
        rows.push(...canonicalRows);
        continue;
      }
    }
    if (trade.recurringOrder) {
      appendRecurringRows(rows, trade, walletKey, contractAddress);
      continue;
    }

    const makerKey = normalizeAddress(trade.maker);
    const takerKey = normalizeAddress(trade.taker);
    const isMaker = walletKey === makerKey;
    const isTaker = walletKey === takerKey;
    const isOpenTakerTrade = isZeroTradeTakerAddress(trade.taker);
    const sourceKind = resolveTradeSourceKind(trade);
    const termsVisibility = getTradeTermsVisibility(trade);
    const amountsVisible =
      termsVisibility === 'public' ||
      (termsVisibility === 'direct-private-terms' && hasHydratedDirectTradeTerms(trade));
    const acceptedDirectPrivateTerms =
      termsVisibility === 'direct-private-terms' &&
      trade.status === 'accepted' &&
      !amountsVisible;
    const acceptedDirectTrade =
      sourceKind === 'direct' &&
      trade.status === 'accepted';

    let renderedWalletFillEvents = false;
    if (sourceKind === 'standard') {
      for (const event of trade.walletFillEvents ?? []) {
        const fillerKey = normalizeAddress(event.filler);
        const isFiller = walletKey === fillerKey;
        if (!isMaker && !isFiller) continue;
        renderedWalletFillEvents = true;
        const offerVisible = isPositiveAmount(event.offerAmount);
        const requestVisible = isPositiveAmount(event.requestAmount);
        const bought = isMaker
          ? withAmount(trade.request, event.requestAmount, requestVisible)
          : withAmount(trade.offer, event.offerAmount, offerVisible);
        const sold = isMaker
          ? withAmount(trade.offer, event.offerAmount, offerVisible)
          : withAmount(trade.request, event.requestAmount, requestVisible);
        rows.push({
          key: `${buildTradeSnapshotKey(trade.tradeId, contractAddress)}:partial:${event.fillIndex}:${fillerKey}:${event.txHash ?? ''}:${event.logIndex ?? ''}`,
          contractAddress,
          localId: trade.tradeId,
          role: isMaker ? 'maker' : isTaker ? 'taker' : 'filler',
          sourceKind,
          counterparty: isMaker ? event.filler : trade.maker,
          bought,
          sold,
          tokenFlows: buildTokenFlows([trade.offer, trade.request], bought, sold),
          amountVisibility: 'public',
          sequence: event.fillIndex,
          ...(event.txHash ? { txHash: event.txHash } : {}),
          ...(event.blockNumber !== undefined ? { blockNumber: event.blockNumber } : {})
        });
      }
    }

    if (renderedWalletFillEvents) {
      continue;
    }

    let renderedPrivateReceiptRows = false;
    for (const receipt of trade.privateFillReceipts ?? []) {
      const fillerKey = normalizeAddress(receipt.filler);
      const isFiller = walletKey === fillerKey;
      if (!isMaker && !isFiller) continue;
      renderedPrivateReceiptRows = true;
      const offerVisible = isPositiveAmount(receipt.offerAmount);
      const requestVisible = isPositiveAmount(receipt.requestAmount);
      const bought = isMaker
        ? withAmount(trade.request, receipt.requestAmount, requestVisible)
        : withAmount(trade.offer, receipt.offerAmount, offerVisible);
      const sold = isMaker
        ? withAmount(trade.offer, receipt.offerAmount, offerVisible)
        : withAmount(trade.request, receipt.requestAmount, requestVisible);
      rows.push({
        key: `${buildTradeSnapshotKey(trade.tradeId, contractAddress)}:private:${receipt.fillIndex}:${isMaker ? 'maker' : 'filler'}`,
        contractAddress,
        localId: trade.tradeId,
        role: isMaker ? 'maker' : 'filler',
        sourceKind,
        counterparty: isMaker ? receipt.filler : trade.maker,
        bought,
        sold,
        tokenFlows: buildTokenFlows([trade.offer, trade.request], bought, sold),
        amountVisibility: offerVisible && requestVisible ? 'private-revealed' : 'private-hidden',
        sequence: receipt.fillIndex,
        ...(receipt.txHash ? { txHash: receipt.txHash } : {}),
        ...(receipt.blockNumber !== undefined ? { blockNumber: receipt.blockNumber } : {})
      });
    }

    if (renderedPrivateReceiptRows) {
      continue;
    }
    if (sourceKind !== 'direct') {
      continue;
    }

    const walletFill = trade.walletFillState;
    const hasWalletFill = Boolean(
      walletFill && (isPositiveAmount(walletFill.offerAmountReceived) || isPositiveAmount(walletFill.requestAmountPaid))
    );
    const filledOfferAmount = walletFill?.offerAmountReceived ?? trade.fillState?.filledOfferAmount;
    const filledRequestAmount = walletFill?.requestAmountPaid ?? trade.fillState?.filledRequestAmount;
    const positiveFilledOfferAmount = isPositiveAmount(filledOfferAmount) ? filledOfferAmount : undefined;
    const positiveFilledRequestAmount = isPositiveAmount(filledRequestAmount) ? filledRequestAmount : undefined;
    const hasVisibleFill = Boolean(positiveFilledOfferAmount || positiveFilledRequestAmount);
    const walletIsIndexedFiller = Boolean(trade.walletHasFill && !isMaker && !isTaker && isOpenTakerTrade);

    if (!isMaker && !isTaker && !walletIsIndexedFiller && !hasWalletFill) {
      continue;
    }
    if (
      !acceptedDirectPrivateTerms &&
      !acceptedDirectTrade &&
      !hasVisibleFill &&
      !hasWalletFill &&
      (trade.status !== 'accepted' || trade.fillState)
    ) {
      continue;
    }
    if (trade.status === 'open' && !hasVisibleFill && !walletIsIndexedFiller) {
      continue;
    }

    const role: TradeTransactionHistoryRole = isMaker ? 'maker' : isTaker ? 'taker' : 'filler';
    const counterparty = isMaker
      ? isZeroTradeTakerAddress(trade.taker)
        ? ''
        : trade.taker
      : trade.maker;
    const bought = isMaker
      ? withAmount(trade.request, positiveFilledRequestAmount ?? trade.request.amount, amountsVisible)
      : withAmount(trade.offer, positiveFilledOfferAmount ?? trade.offer.amount, amountsVisible);
    const sold = isMaker
      ? withAmount(trade.offer, positiveFilledOfferAmount ?? trade.offer.amount, amountsVisible)
      : withAmount(trade.request, positiveFilledRequestAmount ?? trade.request.amount, amountsVisible);

    rows.push({
      key: `${buildTradeSnapshotKey(trade.tradeId, contractAddress)}:visible:${role}`,
      contractAddress,
      localId: trade.tradeId,
      role,
      sourceKind,
      counterparty,
      bought,
      sold,
      tokenFlows: buildTokenFlows([trade.offer, trade.request], bought, sold),
      amountVisibility:
        termsVisibility === 'public'
          ? 'public'
          : amountsVisible
            ? 'private-revealed'
            : 'private-hidden',
      ...(trade.acceptedTxHash ? { txHash: trade.acceptedTxHash } : {})
    });
  }

  return rows.sort((left, right) => (right.blockNumber ?? 0) - (left.blockNumber ?? 0));
};
