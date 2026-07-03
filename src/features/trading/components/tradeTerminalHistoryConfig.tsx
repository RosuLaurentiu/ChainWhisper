import type { ReactNode } from 'react';
import type { TradeSnapshot } from '../../../lib/appShared';
import type { OtcSwapFillNote } from '../../../lib/otcSwapIntent';
import {
  formatTradeContractIdLabel,
  getMakerPrivateProgressSummary,
  getSnapshotKey,
  getTradeDisplayTerms,
  getTradeTermsVisibility
} from '../../../lib/p2pTradeView';
import {
  buildTradeLifecycleHistoryRows,
  buildTradeTransactionHistoryRows,
  type TradeTransactionHistoryRow
} from '../../../lib/tradeHistory';
import { resolveTradeOrderSummary } from '../../../lib/tradePerspective';
import type { TerminalHistoryPanelConfig } from './P2PTradingPage.helpers';
import {
  TradeTerminalHistoryRows,
  TradeTerminalHistoryWindow,
  type GetTransactionLinkFeedbackProps
} from './TradeTerminalHistoryPanel';

export type TerminalHistoryConfigParams = {
  walletAddress: string;
  walletKey: string;
  revealingPrivateTradeKey: string;
  historyLifecycleTxHashes: Record<string, string>;
  historyTransactionTxHashes: Record<string, string>;
  historyTransactionTimestamps: Record<string, number>;
  swapFillNotes: OtcSwapFillNote[];
  getTransactionLinkFeedbackProps: GetTransactionLinkFeedbackProps;
  revealMakerPrivateProgress: (snapshot: TradeSnapshot, forceReveal?: boolean) => Promise<unknown>;
};

const renderHistoryRows = (
  lifecycleRows: ReturnType<typeof buildTradeLifecycleHistoryRows>,
  transactionRows: TradeTransactionHistoryRow[],
  tradeKey: string,
  params: TerminalHistoryConfigParams
): ReactNode => (
  <TradeTerminalHistoryRows
    lifecycleRows={lifecycleRows}
    transactionRows={transactionRows}
    tradeKey={tradeKey}
    historyLifecycleTxHashes={params.historyLifecycleTxHashes}
    historyTransactionTxHashes={params.historyTransactionTxHashes}
    historyTransactionTimestamps={params.historyTransactionTimestamps}
    swapFillNotes={params.swapFillNotes}
    getTransactionLinkFeedbackProps={params.getTransactionLinkFeedbackProps}
  />
);

export const buildStandardTerminalHistoryConfig = (
  snapshot: TradeSnapshot,
  params: TerminalHistoryConfigParams
): TerminalHistoryPanelConfig => {
  const tradeKey = getSnapshotKey(snapshot);
  const displayTerms = getTradeDisplayTerms(snapshot);
  const displayTrade = {
    ...snapshot,
    offer: displayTerms.offer,
    request: displayTerms.request
  };
  const orderSummary = resolveTradeOrderSummary(displayTrade, params.walletAddress);
  const perspective = orderSummary.perspective;
  const isHiddenLiquidityTerms = getTradeTermsVisibility(snapshot) === 'hidden-liquidity';
  const privateFillReceiptsForWallet = (snapshot.privateFillReceipts ?? []).filter(
    (receipt) => perspective.isMaker || receipt.filler?.toLowerCase() === params.walletKey
  );
  const makerPrivateProgressSummary = perspective.isMaker ? getMakerPrivateProgressSummary(snapshot) : null;
  const canRevealMakerPrivateProgress = Boolean(
    isHiddenLiquidityTerms &&
    params.walletKey.length > 0 &&
    (perspective.isMaker
      ? !makerPrivateProgressSummary || !privateFillReceiptsForWallet.length
      : !privateFillReceiptsForWallet.length)
  );
  const lifecycleRows = buildTradeLifecycleHistoryRows(snapshot);
  const historyRows = buildTradeTransactionHistoryRows([snapshot], params.walletAddress);
  const historyEmptyCopy = !params.walletKey
    ? 'Connect your trading wallet to show your history for this trade.'
    : canRevealMakerPrivateProgress
      ? perspective.isMaker
        ? 'Reveal maker receipts to show your private history for this trade.'
        : 'Reveal your private fill receipts for this trade.'
      : 'No wallet history for this trade yet.';

  return {
    tradeKey,
    title: formatTradeContractIdLabel(snapshot),
    count: lifecycleRows.length + historyRows.length,
    emptyCopy: historyEmptyCopy,
    children: renderHistoryRows(lifecycleRows, historyRows, tradeKey, params),
    revealAction: canRevealMakerPrivateProgress
      ? () => {
          params.revealMakerPrivateProgress(snapshot).catch(() => {});
        }
      : undefined,
    revealLabel: perspective.isMaker ? 'Reveal maker history' : 'Reveal your history',
    revealPending: params.revealingPrivateTradeKey === tradeKey
  };
};

export const buildRecurringTerminalHistoryConfig = (
  snapshot: TradeSnapshot,
  params: TerminalHistoryConfigParams
): TerminalHistoryPanelConfig | null => {
  const recurring = snapshot.recurringOrder;
  if (!recurring) {
    return null;
  }

  const tradeKey = getSnapshotKey(snapshot);
  const isMaker = params.walletKey.length > 0 && snapshot.maker.toLowerCase() === params.walletKey;
  const baseHidden = recurring.mode !== 'public' && recurring.baseAsset.kind === 'private-erc20';
  const quoteHidden = recurring.mode !== 'public' && recurring.quoteAsset.kind === 'private-erc20';
  const privateExecutionsForWallet = (recurring.privateExecutions ?? []).filter(
    (execution) => isMaker || execution.filler?.toLowerCase() === params.walletKey
  );
  const hasPrivateInventoryToReveal =
    isMaker &&
    (
      (baseHidden && recurring.hasPrivateBaseInventory && recurring.makerPrivateInventory?.baseInventory === undefined) ||
      (quoteHidden && recurring.hasPrivateQuoteInventory && recurring.makerPrivateInventory?.quoteInventory === undefined)
    );
  const canRevealRecurringPrivate =
    params.walletKey.length > 0 &&
    recurring.mode !== 'public' &&
    (isMaker
      ? hasPrivateInventoryToReveal || (!privateExecutionsForWallet.length && recurring.executionCount > 0)
      : !privateExecutionsForWallet.length && recurring.executionCount > 0);
  const lifecycleRows = buildTradeLifecycleHistoryRows(snapshot);
  const historyRows = buildTradeTransactionHistoryRows([snapshot], params.walletAddress);
  const emptyCopy =
    !params.walletKey
      ? 'Connect your trading wallet to show your history for this order.'
      : canRevealRecurringPrivate
        ? isMaker
          ? 'Reveal this order to show your private maker receipts.'
          : 'Reveal your wallet receipts to show the private buys and sells you made.'
        : 'No wallet history for this order yet.';

  return {
    tradeKey,
    title: formatTradeContractIdLabel(snapshot),
    count: lifecycleRows.length + historyRows.length,
    emptyCopy,
    children: renderHistoryRows(lifecycleRows, historyRows, tradeKey, params),
    revealAction: canRevealRecurringPrivate
      ? () => {
          params.revealMakerPrivateProgress(snapshot).catch(() => {});
        }
      : undefined,
    revealLabel: 'Reveal history',
    revealPending: params.revealingPrivateTradeKey === tradeKey
  };
};

export const buildTerminalHistoryConfig = (
  snapshot: TradeSnapshot,
  params: TerminalHistoryConfigParams
): TerminalHistoryPanelConfig | null =>
  snapshot.recurringOrder
    ? buildRecurringTerminalHistoryConfig(snapshot, params)
    : buildStandardTerminalHistoryConfig(snapshot, params);

export function TradeTerminalHistoryWindowForTrade({
  params,
  renderActionNotice,
  snapshot
}: {
  params: TerminalHistoryConfigParams;
  renderActionNotice: (surface: 'history', tradeKey?: string) => ReactNode;
  snapshot: TradeSnapshot;
}) {
  const historyConfig = buildTerminalHistoryConfig(snapshot, params);
  return historyConfig ? <TradeTerminalHistoryWindow config={historyConfig} renderActionNotice={renderActionNotice} /> : null;
}
