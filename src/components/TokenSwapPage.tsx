import {
  formatCotiAmount,
  formatTokenAmount,
  type SwapDirection,
  type SwapFeeModeSelection
} from '../lib/appShared';

type TokenSwapPageProps = {
  tokenToolsSummary: string;
  groupRewardsContractAddress: string;
  rewardsEnabled: boolean;
  rewardsIndicatorLabel: string;
  rewardsPublicReserveWei: bigint | null;
  rewardsPublicPerInteractionWei: bigint | null;
  rewardTokenDecimals: number;
  rewardTokenSymbol: string;
  privateRewardTokenSymbol: string;
  rewardsLowReserve: boolean;
  swapAmountInput: string;
  onSwapAmountInputChange: (value: string) => void;
  swappingTokens: boolean;
  swapInputSymbol: string;
  swapDirection: SwapDirection;
  onSwapDirectionChange: (value: SwapDirection) => void;
  swapFeeModeSelection: SwapFeeModeSelection;
  onSwapFeeModeChange: (value: SwapFeeModeSelection) => void;
  loadingRewardBalances: boolean;
  swapFeeWei: bigint | null;
  swapTokenFeeAmount: bigint | null;
  canSwapRewardTokens: boolean;
  swapButtonLabel: string;
  onSwapRewardTokens: () => Promise<void>;
  swapStatusMessage: string;
  error: string;
};

export default function TokenSwapPage({
  tokenToolsSummary,
  groupRewardsContractAddress,
  rewardsEnabled,
  rewardsIndicatorLabel,
  rewardsPublicReserveWei,
  rewardsPublicPerInteractionWei,
  rewardTokenDecimals,
  rewardTokenSymbol,
  privateRewardTokenSymbol,
  rewardsLowReserve,
  swapAmountInput,
  onSwapAmountInputChange,
  swappingTokens,
  swapInputSymbol,
  swapDirection,
  onSwapDirectionChange,
  swapFeeModeSelection,
  onSwapFeeModeChange,
  loadingRewardBalances,
  swapFeeWei,
  swapTokenFeeAmount,
  canSwapRewardTokens,
  swapButtonLabel,
  onSwapRewardTokens,
  swapStatusMessage,
  error
}: TokenSwapPageProps) {
  return (
    <main className="swap-page-shell">
      <section className="swap-page-panel wallet-meta">
        <div className="wallet-section-header">
          <div>
            <span className="wallet-section-label">Token swap</span>
            <h1 className="swap-page-title">Swap to private token</h1>
          </div>
          <span className="wallet-section-hint">{tokenToolsSummary}</span>
        </div>

        <div className="swap-meta wallet-disclosure-body">
          {groupRewardsContractAddress ? (
            <div className="wallet-section-hint wallet-section-hint-note reward-summary">
              <div className="reward-summary-row">
                <span className="reward-line-label">
                  Contract status
                  <span
                    className={rewardsEnabled ? 'reward-state-dot enabled' : 'reward-state-dot'}
                    title={rewardsIndicatorLabel}
                    aria-label={rewardsIndicatorLabel}
                  />
                </span>
                <strong>
                  {rewardsPublicReserveWei !== null
                    ? `${formatTokenAmount(rewardsPublicReserveWei * 2n, rewardTokenDecimals, 6)} ${rewardTokenSymbol}/${privateRewardTokenSymbol}`
                    : '--'}
                </strong>
              </div>
              <div className="reward-summary-row">
                <span>Per message</span>
                <strong>
                  {rewardsPublicPerInteractionWei !== null
                    ? `${formatTokenAmount(rewardsPublicPerInteractionWei * 2n, rewardTokenDecimals, 6)} ${rewardTokenSymbol}/${privateRewardTokenSymbol}`
                    : '--'}
                </strong>
              </div>
            </div>
          ) : (
            <p className="wallet-section-hint wallet-section-hint-note">
              Rewards contract info is not available for this session yet.
            </p>
          )}
          {rewardsLowReserve ? (
            <p className="wallet-section-hint wallet-section-hint-note">
              Rewards warning: insufficient public token rewards in rewards contract.
            </p>
          ) : null}

          <div className="swap-field">
            <label className="swap-label-sr" htmlFor="swap-page-amount-input">
              Amount
            </label>
            <input
              id="swap-page-amount-input"
              type="text"
              inputMode="decimal"
              value={swapAmountInput}
              onChange={(event) => onSwapAmountInputChange(event.target.value)}
              placeholder={`0.0 ${swapInputSymbol}`}
              disabled={swappingTokens}
            />
          </div>

          <div className="swap-field">
            <span id="swap-page-direction-label" className="swap-label-sr">
              Swap direction
            </span>
            <div className="swap-pill-switch" role="group" aria-labelledby="swap-page-direction-label">
              <button
                type="button"
                className={swapDirection === 'shield' ? 'swap-pill-option active' : 'swap-pill-option'}
                onClick={() => onSwapDirectionChange('shield')}
                disabled={swappingTokens}
                aria-pressed={swapDirection === 'shield'}
              >
                {`${rewardTokenSymbol} to ${privateRewardTokenSymbol}`}
              </button>
              <button
                type="button"
                className={swapDirection === 'unshield' ? 'swap-pill-option active' : 'swap-pill-option'}
                onClick={() => onSwapDirectionChange('unshield')}
                disabled={swappingTokens}
                aria-pressed={swapDirection === 'unshield'}
              >
                {`${privateRewardTokenSymbol} to ${rewardTokenSymbol}`}
              </button>
            </div>
          </div>

          <div className="swap-field">
            <div className="swap-field-label">
              Fee payment
              <span
                className="swap-info-tip"
                title={`Token mode tries ${privateRewardTokenSymbol} first, then ${rewardTokenSymbol}, then COTI fallback. COTI mode pays native fee only.`}
                aria-label="Fee mode info"
              >
                i
              </span>
            </div>
            <div className="swap-pill-switch" role="group" aria-label="Fee payment mode">
              <button
                type="button"
                className={swapFeeModeSelection === 'token' ? 'swap-pill-option active' : 'swap-pill-option'}
                onClick={() => onSwapFeeModeChange('token')}
                disabled={swappingTokens}
                aria-pressed={swapFeeModeSelection === 'token'}
              >
                Token
              </button>
              <button
                type="button"
                className={swapFeeModeSelection === 'coti' ? 'swap-pill-option active' : 'swap-pill-option'}
                onClick={() => onSwapFeeModeChange('coti')}
                disabled={swappingTokens}
                aria-pressed={swapFeeModeSelection === 'coti'}
              >
                COTI
              </button>
            </div>
          </div>

          <div className="swap-quote-row">
            <span>Fee quote</span>
            <strong>
              {loadingRewardBalances
                ? 'Loading...'
                : `COTI ${swapFeeWei !== null ? formatCotiAmount(swapFeeWei) : '--'} | ${rewardTokenSymbol} ${
                    swapTokenFeeAmount !== null ? formatTokenAmount(swapTokenFeeAmount, rewardTokenDecimals, 6) : '--'
                  }`}
            </strong>
          </div>

          <button
            className="connect-btn swap-action-btn"
            type="button"
            onClick={() => {
              onSwapRewardTokens().catch(() => {});
            }}
            disabled={!canSwapRewardTokens}
          >
            {swapButtonLabel}
          </button>
          {swapStatusMessage ? <p className="wallet-section-hint wallet-section-hint-note swap-status-note">{swapStatusMessage}</p> : null}
          {error ? <p className="error">{error}</p> : null}
        </div>
      </section>
    </main>
  );
}
