import type { ReactNode } from 'react';
import type { TradeSnapshot } from '../../../lib/appShared';
import { getSnapshotKey } from '../../../lib/p2pTradeView';
import type { WalletReadAccount } from '../../../lib/walletAccountScope';
import type {
  MyTradeGroupView,
  TradeOverviewCardOptions
} from './P2PTradingPage.helpers';
import TradeRecurringOrderCard from './TradeRecurringOrderCard';
import TradeStandardOrderCard from './TradeStandardOrderCard';

export type TradeOrderCardProps = {
  routeView: string;
  walletAddress: string;
  walletKey: string;
  walletReadAccounts: WalletReadAccount[];
  reversedRateTradeIds: Record<string, boolean>;
  lastCopiedKey: string;
  revealingPrivateTradeKey: string;
  openTradeSnapshot: (trade: TradeSnapshot) => void;
  toggleTradeRateDirection: (tradeId: number, escrowContract?: string) => void;
  resolveKnownTradeAccessSecret: (tradeId: number, escrowContract?: string) => string;
  buildTradeShareUrl: (tradeId: number, accessSecret?: string, escrowContract?: string) => string;
  copyWithFeedback: (value: string, feedbackKey: string) => Promise<void>;
  revealMakerPrivateProgress: (trade: TradeSnapshot, forceReveal?: boolean) => Promise<unknown>;
};

type TradeOverviewCardProps = TradeOrderCardProps & {
  trade: TradeSnapshot;
  options?: TradeOverviewCardOptions;
};

export function TradeOverviewCard({
  trade,
  options = {},
  routeView,
  walletAddress,
  walletKey,
  walletReadAccounts,
  reversedRateTradeIds,
  lastCopiedKey,
  revealingPrivateTradeKey,
  openTradeSnapshot,
  toggleTradeRateDirection,
  resolveKnownTradeAccessSecret,
  buildTradeShareUrl,
  copyWithFeedback,
  revealMakerPrivateProgress
}: TradeOverviewCardProps) {
  if (trade.recurringOrder) {
    return (
      <TradeRecurringOrderCard
        snapshot={trade}
        options={options}
        walletKey={walletKey}
        reversedRateTradeIds={reversedRateTradeIds}
        lastCopiedKey={lastCopiedKey}
        openTradeSnapshot={openTradeSnapshot}
        toggleTradeRateDirection={toggleTradeRateDirection}
        buildTradeShareUrl={buildTradeShareUrl}
        copyWithFeedback={copyWithFeedback}
      />
    );
  }

  return (
    <TradeStandardOrderCard
      trade={trade}
      options={options}
      routeView={routeView}
      walletAddress={walletAddress}
      walletKey={walletKey}
      walletReadAccounts={walletReadAccounts}
      reversedRateTradeIds={reversedRateTradeIds}
      lastCopiedKey={lastCopiedKey}
      revealingPrivateTradeKey={revealingPrivateTradeKey}
      openTradeSnapshot={openTradeSnapshot}
      toggleTradeRateDirection={toggleTradeRateDirection}
      resolveKnownTradeAccessSecret={resolveKnownTradeAccessSecret}
      buildTradeShareUrl={buildTradeShareUrl}
      copyWithFeedback={copyWithFeedback}
      revealMakerPrivateProgress={revealMakerPrivateProgress}
    />
  );
}

type TradeOrderListProps = TradeOrderCardProps & {
  trades: TradeSnapshot[];
  emptyLabel: string;
  gridClassName?: string;
  emptyState?: ReactNode;
  selectedTradeKey: string;
};

export function TradeOrderList({
  trades,
  emptyLabel,
  gridClassName = '',
  emptyState,
  selectedTradeKey,
  ...cardProps
}: TradeOrderListProps) {
  return trades.length > 0 ? (
    <div className={`p2p-offer-grid${gridClassName ? ` ${gridClassName}` : ''}`}>
      {trades.map((trade) => (
        <TradeOverviewCard
          key={getSnapshotKey(trade)}
          trade={trade}
          options={{
            selected: selectedTradeKey ? getSnapshotKey(trade) === selectedTradeKey : false
          }}
          {...cardProps}
        />
      ))}
    </div>
  ) : (
    emptyState ?? <p className="standalone-trade-state">{emptyLabel}</p>
  );
}

type TradeMyOrderListProps = TradeOrderCardProps & {
  trades: TradeSnapshot[];
  groupId: MyTradeGroupView;
  emptyLabel: string;
  emptyState?: ReactNode;
  selectedTradeKey: string;
  canOpenMyTradeTerminal: (trade: TradeSnapshot, groupId: MyTradeGroupView) => boolean;
  openMyTradeTerminal: (trade: TradeSnapshot) => void;
};

export function TradeMyOrderList({
  trades,
  groupId,
  emptyLabel,
  emptyState,
  selectedTradeKey,
  canOpenMyTradeTerminal,
  openMyTradeTerminal,
  ...cardProps
}: TradeMyOrderListProps) {
  if (!trades.length) {
    return emptyState ?? <p className="standalone-trade-state">{emptyLabel}</p>;
  }

  return (
    <div className="p2p-wallet-inline-workspace">
      <div className="p2p-offer-grid p2p-wallet-trade-grid">
        {trades.map((trade) => {
          const tradeKey = getSnapshotKey(trade);
          const canOpenTerminal = canOpenMyTradeTerminal(trade, groupId);
          return (
            <TradeOverviewCard
              key={tradeKey}
              trade={trade}
              options={{
                canOpenTerminal,
                groupId,
                onOpenTerminal: openMyTradeTerminal,
                selected: selectedTradeKey === tradeKey
              }}
              {...cardProps}
            />
          );
        })}
      </div>
    </div>
  );
}
