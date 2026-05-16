import {
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetPayload,
  type TradeSnapshot
} from './appShared';
import { buildTradeSnapshotKey } from './appShared/core';
import { formatTradeContractIdLabel, getTradeTermsVisibility, hasHydratedDirectTradeTerms } from './p2pTradeView';
import { isZeroTradeTakerAddress } from './tradePerspective';

export type TradeTransactionHistoryRole = 'maker' | 'taker' | 'filler';
export type TradeTransactionHistorySource = 'standard' | 'private' | 'direct' | 'recurring';
export type TradeTransactionAmountVisibility = 'public' | 'private-revealed' | 'private-hidden';
export type TradeLifecycleHistoryAction = 'created' | 'edited' | 'replaced' | 'accepted' | 'cancelled';

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
  txHash?: string;
  timestamp?: number;
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

export const buildTradeLifecycleHistoryRows = (trade: TradeSnapshot): TradeLifecycleHistoryRow[] => {
  const contractAddress = trade.escrowContract || TRADE_ESCROW_CONTRACT_ADDRESS;
  const snapshotKey = buildTradeSnapshotKey(trade.tradeId, contractAddress);
  const recurring = trade.recurringOrder;
  const sourceKind = resolveTradeSourceKind(trade);
  const localId = recurring?.orderId ?? trade.tradeId;
  const subjectLabel = formatTradeContractIdLabel(trade);
  const formatRelatedTradeLabel = (tradeId: number): string =>
    formatTradeContractIdLabel({ tradeId, escrowContract: trade.escrowContract });
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

  return rows;
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
  const executions = [...(recurring.publicExecutions ?? []), ...(recurring.privateExecutions ?? [])];

  for (const execution of executions) {
    const fillerKey = normalizeAddress(execution.filler);
    const isFiller = walletKey === fillerKey;
    if (!isMaker && !isFiller) continue;

    const makerBuysBase = execution.side === 'buy';
    const walletBuysBase = isMaker ? makerBuysBase : !makerBuysBase;
    const baseVisible = isPositiveAmount(execution.baseAmount);
    const quoteVisible = isPositiveAmount(execution.quoteAmount);
    const amountVisibility: TradeTransactionAmountVisibility =
      recurring.mode === 'public' ? 'public' : baseVisible && quoteVisible ? 'private-revealed' : 'private-hidden';
    const bought = walletBuysBase
      ? withAmount(recurring.baseAsset, execution.baseAmount, baseVisible)
      : withAmount(recurring.quoteAsset, execution.quoteAmount, quoteVisible);
    const sold = walletBuysBase
      ? withAmount(recurring.quoteAsset, execution.quoteAmount, quoteVisible)
      : withAmount(recurring.baseAsset, execution.baseAmount, baseVisible);

    rows.push({
      key: `${buildTradeSnapshotKey(trade.tradeId, contractAddress)}:recurring:${execution.fillIndex}:${isMaker ? 'maker' : 'filler'}`,
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

export const buildTradeTransactionHistoryRows = (
  trades: TradeSnapshot[],
  walletAddress: string
): TradeTransactionHistoryRow[] => {
  const walletKey = normalizeAddress(walletAddress);
  if (!walletKey) return [];

  const rows: TradeTransactionHistoryRow[] = [];

  for (const trade of trades) {
    const contractAddress = trade.escrowContract || TRADE_ESCROW_CONTRACT_ADDRESS;
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

    for (const receipt of trade.privateFillReceipts ?? []) {
      const fillerKey = normalizeAddress(receipt.filler);
      const isFiller = walletKey === fillerKey;
      if (!isMaker && !isFiller) continue;
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

    if ((trade.privateFillReceipts ?? []).length > 0) {
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
