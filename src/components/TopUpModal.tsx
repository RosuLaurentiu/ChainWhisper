import {
  BURNER_TOP_UP_ESTIMATED_COTI_PER_MESSAGE_WEI,
  BURNER_TOP_UP_MAX_MESSAGE_TARGET,
  BURNER_TOP_UP_MIN_MESSAGE_TARGET,
  formatCotiAmount,
  formatTokenAmount
} from '../lib/appShared';

type TopUpModalProps = {
  isOpen: boolean;
  initializingBurner: boolean;
  loadingTopUpQuote: boolean;
  burnerAddress: string;
  topUpAmountWei: bigint | null;
  topUpMessageTarget: number;
  onTopUpMessageTargetChange: (value: number) => void;
  burnerBalanceWei: bigint | null;
  estimatedMessagesLeft: bigint | null;
  topUpAmountLabel: string;
  onTopUpBurnerWithWallet: () => Promise<void>;
  onClose: () => void;
};

export default function TopUpModal({
  isOpen,
  initializingBurner,
  loadingTopUpQuote,
  burnerAddress,
  topUpAmountWei,
  topUpMessageTarget,
  onTopUpMessageTargetChange,
  burnerBalanceWei,
  estimatedMessagesLeft,
  topUpAmountLabel,
  onTopUpBurnerWithWallet,
  onClose
}: TopUpModalProps) {
  if (!isOpen) {
    return null;
  }

  const canTopUp = Boolean(burnerAddress) && topUpAmountWei !== null && topUpAmountWei > 0n;
  const estimatedTopUpRateLabel = `${formatCotiAmount(BURNER_TOP_UP_ESTIMATED_COTI_PER_MESSAGE_WEI, 3)} COTI/msg`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card topup-modal" onClick={(event) => event.stopPropagation()}>
        <h3>Top Up App Wallet</h3>
        <div className="topup-stats-grid">
          <div className="topup-stat">
            <span>Balance</span>
            <strong>{loadingTopUpQuote ? 'Loading...' : `${burnerBalanceWei !== null ? formatTokenAmount(burnerBalanceWei, 18, 4) : '--'} COTI`}</strong>
          </div>
          <div className="topup-stat">
            <span>Messages left</span>
            <strong>{loadingTopUpQuote ? 'Loading...' : estimatedMessagesLeft !== null ? estimatedMessagesLeft.toString() : '--'}</strong>
          </div>
        </div>

        <input
          className="topup-slider"
          type="range"
          min={BURNER_TOP_UP_MIN_MESSAGE_TARGET}
          max={BURNER_TOP_UP_MAX_MESSAGE_TARGET}
          step={1}
          value={topUpMessageTarget}
          onChange={(event) => onTopUpMessageTargetChange(Number(event.target.value))}
          aria-label="Top up message target"
        />
        <p className="topup-estimate-line">
          Approx @ {estimatedTopUpRateLabel}: <strong>{topUpMessageTarget}</strong> msgs = <strong>{topUpAmountLabel}</strong>
        </p>

        <div className="modal-actions">
          <button type="button" className="connect-btn" onClick={onClose} disabled={initializingBurner}>
            Close
          </button>
          <button
            type="button"
            className="connect-btn wallet-primary-action"
            onClick={() => {
              onTopUpBurnerWithWallet().catch(() => {});
            }}
            disabled={initializingBurner || loadingTopUpQuote || !canTopUp}
          >
            Top Up with Wallet
          </button>
        </div>
      </div>
    </div>
  );
}
