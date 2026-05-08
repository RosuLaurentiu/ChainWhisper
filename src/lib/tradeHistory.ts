import {
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetPayload,
  type TradeSnapshot
} from './appShared';
import { buildTradeSnapshotKey } from './appShared/core';
import { getTradeTermsVisibility, hasHydratedDirectTradeTerms } from './p2pTradeView';
import { isZeroTradeTakerAddress } from './tradePerspective';

export type TradeTransactionHistoryRole = 'maker' | 'taker' | 'filler';
export type TradeTransactionHistorySource = 'standard' | 'private' | 'direct' | 'recurring';
export type TradeTransactionAmountVisibility = 'public' | 'private-revealed' | 'private-hidden';

export type TradeTransactionAsset = TradeAssetPayload & {
  visible: boolean;
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
  amountVisibility: TradeTransactionAmountVisibility;
  txHash?: string;
  blockNumber?: number;
};

const normalizeAddress = (value?: string | null): string => value?.trim().toLowerCase() ?? '';

const isPositiveAmount = (value?: string): boolean => /^\d+$/.test(value ?? '') && BigInt(value ?? '0') > 0n;

const withAmount = (asset: TradeAssetPayload, amount: string | undefined, visible: boolean): TradeTransactionAsset => ({
  ...asset,
  amount: visible && amount && /^\d+$/.test(amount) ? amount : asset.amount,
  visible
});

const resolveTradeSourceKind = (trade: TradeSnapshot): TradeTransactionHistorySource => {
  if (trade.recurringOrder) return 'recurring';
  if (getTradeTermsVisibility(trade) === 'hidden-liquidity') return 'private';
  if (trade.escrowContract && normalizeAddress(trade.escrowContract) !== normalizeAddress(TRADE_ESCROW_CONTRACT_ADDRESS)) {
    return 'direct';
  }
  return 'standard';
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
      baseVisible && quoteVisible ? 'private-revealed' : 'private-hidden';

    rows.push({
      key: `${buildTradeSnapshotKey(trade.tradeId, contractAddress)}:recurring:${execution.fillIndex}:${isMaker ? 'maker' : 'filler'}`,
      contractAddress,
      localId: recurring.orderId,
      role: isMaker ? 'maker' : 'filler',
      sourceKind: 'recurring',
      counterparty: isMaker ? execution.filler : trade.maker,
      bought: walletBuysBase
        ? withAmount(recurring.baseAsset, execution.baseAmount, baseVisible)
        : withAmount(recurring.quoteAsset, execution.quoteAmount, quoteVisible),
      sold: walletBuysBase
        ? withAmount(recurring.quoteAsset, execution.quoteAmount, quoteVisible)
        : withAmount(recurring.baseAsset, execution.baseAmount, baseVisible),
      amountVisibility,
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

    for (const receipt of trade.privateFillReceipts ?? []) {
      const fillerKey = normalizeAddress(receipt.filler);
      const isFiller = walletKey === fillerKey;
      if (!isMaker && !isFiller) continue;
      const offerVisible = isPositiveAmount(receipt.offerAmount);
      const requestVisible = isPositiveAmount(receipt.requestAmount);
      rows.push({
        key: `${buildTradeSnapshotKey(trade.tradeId, contractAddress)}:private:${receipt.fillIndex}:${isMaker ? 'maker' : 'filler'}`,
        contractAddress,
        localId: trade.tradeId,
        role: isMaker ? 'maker' : 'filler',
        sourceKind,
        counterparty: isMaker ? receipt.filler : trade.maker,
        bought: isMaker
          ? withAmount(trade.request, receipt.requestAmount, requestVisible)
          : withAmount(trade.offer, receipt.offerAmount, offerVisible),
        sold: isMaker
          ? withAmount(trade.offer, receipt.offerAmount, offerVisible)
          : withAmount(trade.request, receipt.requestAmount, requestVisible),
        amountVisibility: offerVisible && requestVisible ? 'private-revealed' : 'private-hidden',
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
    const hasVisibleFill = isPositiveAmount(filledOfferAmount) || isPositiveAmount(filledRequestAmount);
    const walletIsIndexedFiller = Boolean(trade.walletHasFill && !isMaker && !isTaker && isOpenTakerTrade);

    if (!isMaker && !isTaker && !walletIsIndexedFiller && !hasWalletFill) {
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
      ? withAmount(trade.request, filledRequestAmount ?? trade.request.amount, amountsVisible)
      : withAmount(trade.offer, filledOfferAmount ?? trade.offer.amount, amountsVisible);
    const sold = isMaker
      ? withAmount(trade.offer, filledOfferAmount ?? trade.offer.amount, amountsVisible)
      : withAmount(trade.request, filledRequestAmount ?? trade.request.amount, amountsVisible);

    rows.push({
      key: `${buildTradeSnapshotKey(trade.tradeId, contractAddress)}:visible:${role}`,
      contractAddress,
      localId: trade.tradeId,
      role,
      sourceKind,
      counterparty,
      bought,
      sold,
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
