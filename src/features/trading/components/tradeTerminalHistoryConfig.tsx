import type { ReactNode } from 'react';
import type { TradeSnapshot } from '../../../lib/appShared';
import type { OtcSwapFillNote } from '../../../lib/otcSwapIntent';
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
  getWalletOwnerAccount,
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

type TerminalHistoryWalletParams = Pick<TerminalHistoryConfigParams, 'walletAddress' | 'walletReadAccounts'>;

const findReadableMakerAccount = (
  snapshot: TradeSnapshot,
  accounts: WalletReadAccount[]
): WalletReadAccount | null => {
  const makerKey = snapshot.maker.trim().toLowerCase();
  return accounts.find((account) => account.key === makerKey) ?? null;
};

const hasRecurringExecutionsForWallet = (snapshot: TradeSnapshot, walletKey?: string): boolean => {
  const key = walletKey?.trim().toLowerCase();
  if (!key || !snapshot.recurringOrder) {
    return false;
  }
  return [
    ...(snapshot.recurringOrder.privateExecutions ?? []),
    ...(snapshot.recurringOrder.publicExecutions ?? [])
  ].some((execution) => execution.filler?.toLowerCase() === key);
};

export const resolveTerminalHistoryWallet = (
  snapshot: TradeSnapshot,
  params: TerminalHistoryWalletParams
): { walletAddress: string; walletKey: string } => {
  const actionAccount = getWalletActionAccount(params.walletReadAccounts);
  const ownerAccount = getWalletOwnerAccount(params.walletReadAccounts);
  const perspectiveAddress = getTradeAccountPerspectiveAddress(snapshot, { actionAccount, ownerAccount }) || params.walletAddress;
  const makerAddress = findReadableMakerAccount(snapshot, params.walletReadAccounts)?.address;
  const recurringFallbackAddress =
    snapshot.recurringOrder && actionAccount && !hasRecurringExecutionsForWallet(snapshot, actionAccount.key) &&
    ownerAccount && hasRecurringExecutionsForWallet(snapshot, ownerAccount.key)
      ? ownerAccount.address
      : '';
  const walletAddress =
    makerAddress
      ? makerAddress
      : snapshot.recurringOrder
        ? recurringFallbackAddress || actionAccount?.address || perspectiveAddress
      : perspectiveAddress;
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
  const lifecycleRows = buildTradeLifecycleHistoryRows(snapshot);
  const historyRows = buildTradeTransactionHistoryRows([snapshot], historyWallet.walletAddress);
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
    children: renderHistoryRows(lifecycleRows, historyRows, tradeKey, params)
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
  const lifecycleRows = buildTradeLifecycleHistoryRows(snapshot);
  const historyRows = buildTradeTransactionHistoryRows([snapshot], historyWallet.walletAddress);
  const emptyCopy =
    !historyWallet.walletKey
      ? 'Connect your trading wallet to show your history for this order.'
      : 'No wallet history for this order yet.';

  return {
    tradeKey,
    title: formatTradeContractIdLabel(snapshot),
    count: lifecycleRows.length + historyRows.length,
    emptyCopy,
    children: renderHistoryRows(lifecycleRows, historyRows, tradeKey, params)
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
