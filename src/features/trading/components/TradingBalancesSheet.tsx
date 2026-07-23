import { useEffect, useMemo, useRef, useState } from 'react';
import { useModalA11y } from '../../../shared/hooks/useModalA11y';
import { buildTotalTradingBalanceItems, type TradingBalanceDisplayItem } from '../../../lib/tradingBalances';

type BalanceAccountRole = 'chainwhisper' | 'owner';
type BalanceView = 'total' | BalanceAccountRole;

type TradingBalanceListProps = {
  balances: TradingBalanceDisplayItem[];
  walletConnected: boolean;
};

type TradingBalanceDockProps = TradingBalanceListProps & {
  balancesHidden: boolean;
  onOpenContracts: () => void;
  onToggleBalancesHidden: () => void;
};

type TradingBalancesSheetProps = TradingBalanceListProps & {
  isOpen: boolean;
  onClose: () => void;
  onOpenContracts: () => void;
};

const getBalanceEmptyText = (walletConnected: boolean): string =>
  walletConnected
    ? 'No available token balances yet.'
    : 'Connect a wallet to show token balances.';

const getBalanceViewCountLabel = (count: number): string => `${count} token${count === 1 ? '' : 's'}`;

const BALANCE_ACCOUNT_OPTIONS: Array<{
  id: BalanceAccountRole;
  label: string;
}> = [
  { id: 'chainwhisper', label: 'ChainWhisper' },
  { id: 'owner', label: 'Owner' }
];

export function TradingBalanceList({ balances, walletConnected }: TradingBalanceListProps) {
  const [selectedBalanceView, setSelectedBalanceView] = useState<BalanceView>('total');
  const totalBalances = useMemo(() => buildTotalTradingBalanceItems(balances), [balances]);
  const accountGroups = useMemo(
    () =>
      BALANCE_ACCOUNT_OPTIONS.map((option) => ({
        ...option,
        balances: balances.filter((balance) => (balance.accountRole ?? 'chainwhisper') === option.id)
      })).filter((group) => group.balances.length > 0),
    [balances]
  );
  const balanceViews = useMemo(
    () => [
      ...(accountGroups.length > 1 && totalBalances.length > 0
        ? [{ id: 'total' as const, label: 'Total', balances: totalBalances }]
        : []),
      ...accountGroups
    ],
    [accountGroups, totalBalances]
  );
  const availableViewKey = balanceViews.map((view) => view.id).join('|');
  const activeView = balanceViews.find((view) => view.id === selectedBalanceView) ?? balanceViews[0];
  const activeViewIndex = activeView ? balanceViews.findIndex((view) => view.id === activeView.id) : -1;
  const nextView =
    activeViewIndex >= 0 && balanceViews.length > 1
      ? balanceViews[(activeViewIndex + 1) % balanceViews.length]
      : undefined;

  useEffect(() => {
    if (activeView && activeView.id !== selectedBalanceView) {
      setSelectedBalanceView(activeView.id);
    }
  }, [activeView, selectedBalanceView, availableViewKey]);

  if (balances.length === 0 || !activeView) {
    return <p className="p2p-balance-empty">{getBalanceEmptyText(walletConnected)}</p>;
  }

  return (
    <div className="p2p-balance-groups">
      {balanceViews.length > 1 ? (
        <button
          type="button"
          className="p2p-balance-view-toggle"
          onClick={() => {
            if (nextView) {
              setSelectedBalanceView(nextView.id);
            }
          }}
          title={nextView ? `Showing ${activeView.label}; click to show ${nextView.label}` : activeView.label}
          aria-label={nextView ? `Showing ${activeView.label} balances. Show ${nextView.label} balances.` : `${activeView.label} balances`}
        >
          <span>{activeView.label}</span>
          <small>{getBalanceViewCountLabel(activeView.balances.length)}</small>
        </button>
      ) : (
        <span className="p2p-balance-account-label">
          {activeView.label}
          <small>{getBalanceViewCountLabel(activeView.balances.length)}</small>
        </span>
      )}
      <div
        className={`p2p-balance-list p2p-balance-list-${activeView.id}`}
        aria-label={`${activeView.label} balances`}
      >
        {activeView.balances.map((balance) => (
          <article className="p2p-balance-item" data-balance-kind={balance.kindLabel} key={balance.id}>
            <div className="p2p-balance-item-main">
              <strong className="p2p-balance-symbol">{balance.symbol}</strong>
            </div>
            <span className="p2p-balance-amount" title={`${balance.amountLabel} ${balance.symbol}`}>
              {balance.amountLabel}
            </span>
          </article>
        ))}
      </div>
    </div>
  );
}

export function TradingBalanceDock({
  balances,
  balancesHidden,
  walletConnected,
  onOpenContracts,
  onToggleBalancesHidden
}: TradingBalanceDockProps) {
  return (
    <section className={balancesHidden ? 'p2p-balance-dock p2p-balance-dock-hidden' : 'p2p-balance-dock'} aria-label="Trading balances">
      <button
        type="button"
        className="p2p-balance-dock-title"
        onClick={onToggleBalancesHidden}
        aria-pressed={balancesHidden}
        title={balancesHidden ? 'Show wallet balances and address' : 'Hide wallet balances and address'}
      >
        Balances
      </button>
      {balancesHidden ? <p className="p2p-balance-empty">Hidden</p> : <TradingBalanceList balances={balances} walletConnected={walletConnected} />}
      <button type="button" className="p2p-footer-contracts-btn" onClick={onOpenContracts}>
        Contracts
      </button>
    </section>
  );
}

export default function TradingBalancesSheet({
  balances,
  isOpen,
  onClose,
  onOpenContracts,
  walletConnected
}: TradingBalancesSheetProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalA11y({ dialogRef, isOpen, onClose });

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop p2p-balances-sheet-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-card p2p-balances-sheet-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="p2p-balances-sheet-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p2p-balances-sheet-head">
          <div>
            <h3 id="p2p-balances-sheet-title">Balances</h3>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <TradingBalanceList balances={balances} walletConnected={walletConnected} />
        <button
          type="button"
          className="p2p-balances-sheet-contracts"
          onClick={() => {
            onClose();
            onOpenContracts();
          }}
        >
          Contracts
        </button>
      </div>
    </div>
  );
}
