import { useRef } from 'react';
import { useModalA11y } from '../hooks/useModalA11y';
import type { TradingBalanceDisplayItem } from '../lib/tradingBalances';

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
};

const getBalanceEmptyText = (walletConnected: boolean): string =>
  walletConnected
    ? 'No non-zero app token balances to show.'
    : 'Connect a trading wallet to show allowed token balances.';

export function TradingBalanceList({ balances, walletConnected }: TradingBalanceListProps) {
  if (balances.length === 0) {
    return <p className="p2p-balance-empty">{getBalanceEmptyText(walletConnected)}</p>;
  }

  const standardBalances = balances.filter((balance) => balance.kindLabel !== 'Private');
  const privateBalances = balances.filter((balance) => balance.kindLabel === 'Private');
  const groups = [
    {
      id: 'standard',
      label: 'Standard token balances',
      balances: standardBalances
    },
    {
      id: 'private',
      label: 'Private token balances',
      balances: privateBalances
    }
  ].filter((group) => group.balances.length > 0);

  return (
    <div className="p2p-balance-groups">
      {groups.map((group) => (
        <div
          className={`p2p-balance-list p2p-balance-list-${group.id}`}
          aria-label={group.label}
          key={group.id}
        >
          {group.balances.map((balance) => (
            <article className="p2p-balance-item" data-balance-kind={balance.kindLabel} key={balance.id}>
              <div className="p2p-balance-item-main">
                <strong className="p2p-balance-symbol">{balance.symbol}</strong>
              </div>
              <span className="p2p-balance-amount">{balance.amountLabel}</span>
            </article>
          ))}
        </div>
      ))}
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
      </div>
    </div>
  );
}
