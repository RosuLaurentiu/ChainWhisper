import type { ReactNode } from 'react';
import type { TradeSnapshot } from '../../../lib/appShared';
import type { OtcSwapFillNote } from '../../../lib/otcSwapIntent';
import type { TradeHistoryV2ExecutionRow } from '../../../lib/tradeHistoryV2Ledger';
import type { TradeHistoryV2CanonicalLifecycleEvent } from '../../../lib/tradeHistoryV2Materialize';
import {
  formatTradeContractIdLabel,
  getSnapshotKey,
  getTradeDisplayTerms
} from '../../../lib/p2pTradeView';
import {
  buildTradeLifecycleHistoryRows,
  buildTradeTransactionHistoryRows,
  type TradeTransactionHistoryRow
} from '../../../lib/tradeHistory';
import { resolveTradeOrderSummary } from '../../../lib/tradePerspective';
import {
  getTradeAccountPerspectiveAddress,
  getWalletActionAccount,
  type WalletReadAccount
} from '../../../lib/walletAccountScope';
import type { TerminalHistoryPanelConfig } from './P2PTradingPage.helpers';
import {
  TradeTerminalHistoryRows,
  TradeTerminalHistoryWindow,
  type GetTransactionLinkFeedbackProps
} from './TradeTerminalHistoryPanel';

export type TerminalHistoryConfigParams = {
  walletAddress: string;
  walletReadAccounts: WalletReadAccount[];
  historyLifecycleTxHashes: Record<string, string>;
  historyTransactionTxHashes: Record<string, string>;
  historyTransactionTimestamps: Record<string, number>;
  swapFillNotes: OtcSwapFillNote[];
  getTransactionLinkFeedbackProps: GetTransactionLinkFeedbackProps;
  canonicalV2Rows?: readonly TradeHistoryV2ExecutionRow[];
  canonicalV2LifecycleEvents?: readonly TradeHistoryV2CanonicalLifecycleEvent[];
  canonicalV2Loading?: boolean;
  canonicalV2Error?: string;
};

const renderHistoryRows = (
  lifecycleRows: ReturnType<typeof buildTradeLifecycleHistoryRows>,
  transactionRows: TradeTransactionHistoryRow[],
  tradeKey: string,
  params: TerminalHistoryConfigParams,
  statusMessage?: string
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
    statusMessage={statusMessage}
  />
);

const resolveCanonicalV2HistoryStatus = (
  snapshot: TradeSnapshot,
  params: TerminalHistoryConfigParams
): string | undefined => {
  if (!snapshot.v2 && !snapshot.recurringOrder?.v2) return undefined;
  if (params.canonicalV2Error) return 'Exact fill history could not be verified. Retry the trade refresh.';
  if (params.canonicalV2Loading) return 'Verifying exact fill amounts…';
  return undefined;
};

type TerminalHistoryWalletParams = Pick<TerminalHistoryConfigParams, 'walletAddress' | 'walletReadAccounts'>;

export const resolveTerminalHistoryWallet = (
  snapshot: TradeSnapshot,
  params: TerminalHistoryWalletParams
): { walletAddress: string; walletKey: string } => {
  const actionAccount = getWalletActionAccount(params.walletReadAccounts);
  const walletAddress = actionAccount?.address || getTradeAccountPerspectiveAddress(snapshot, {
    actionAccount,
    ownerAccount: actionAccount
  }) || params.walletAddress;
  return {
    walletAddress,
    walletKey: walletAddress.trim().toLowerCase()
  };
};

export const resolveTerminalHistoryMergeWalletKey = (
  snapshot: TradeSnapshot,
  params: TerminalHistoryWalletParams,
  fallbackWalletKey = ''
): string => resolveTerminalHistoryWallet(snapshot, params).walletKey || fallbackWalletKey;

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
  const historyWallet = resolveTerminalHistoryWallet(snapshot, params);
  const orderSummary = resolveTradeOrderSummary(displayTrade, historyWallet.walletAddress);
  const perspective = orderSummary.perspective;
  const privateFillReceiptsForWallet = (snapshot.privateFillReceipts ?? []).filter(
    (receipt) => perspective.isMaker || receipt.filler?.toLowerCase() === historyWallet.walletKey
  );
  const lifecycleRows = buildTradeLifecycleHistoryRows(snapshot, params.canonicalV2LifecycleEvents);
  const historyRows = buildTradeTransactionHistoryRows(
    [snapshot],
    historyWallet.walletAddress,
    params.canonicalV2Rows
  );
  const historyEmptyCopy = !historyWallet.walletKey
    ? 'Connect your trading wallet to show your history for this trade.'
    : privateFillReceiptsForWallet.length
      ? 'No visible wallet history for this trade yet.'
      : 'No wallet history for this trade yet.';

  return {
    tradeKey,
    title: formatTradeContractIdLabel(snapshot),
    count: lifecycleRows.length + historyRows.length,
    emptyCopy: historyEmptyCopy,
    children: renderHistoryRows(
      lifecycleRows,
      historyRows,
      tradeKey,
      params,
      resolveCanonicalV2HistoryStatus(snapshot, params)
    )
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
  const historyWallet = resolveTerminalHistoryWallet(snapshot, params);
  const lifecycleRows = buildTradeLifecycleHistoryRows(snapshot, params.canonicalV2LifecycleEvents);
  const historyRows = buildTradeTransactionHistoryRows(
    [snapshot],
    historyWallet.walletAddress,
    params.canonicalV2Rows
  );
  const emptyCopy =
    !historyWallet.walletKey
      ? 'Connect your trading wallet to show your history for this order.'
      : 'No wallet history for this order yet.';

  return {
    tradeKey,
    title: formatTradeContractIdLabel(snapshot),
    count: lifecycleRows.length + historyRows.length,
    emptyCopy,
    children: renderHistoryRows(
      lifecycleRows,
      historyRows,
      tradeKey,
      params,
      resolveCanonicalV2HistoryStatus(snapshot, params)
    )
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
