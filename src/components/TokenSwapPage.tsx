import {
  formatCotiAmount,
  formatTokenAmount,
  type SwapDirection,
  type SwapFeeModeSelection
} from '../lib/appShared';

type TokenSwapPageProps = {
  tokenToolsSummary: string;
  shieldVaultTokenBalanceWei: bigint | null;
  rewardTokenDecimals: number;
  rewardTokenSymbol: string;
  privateRewardTokenSymbol: string;
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
  walletAddress: string;
  onCotiNetwork: boolean;
  hasAesReady: boolean;
  onRefreshRewardBalances: () => void;
  canSwapRewardTokens: boolean;
  swapButtonLabel: string;
  onSwapRewardTokens: () => Promise<void>;
  swapStatusMessage: string;
  error: string;
};

export default function TokenSwapPage({
  tokenToolsSummary,
  shieldVaultTokenBalanceWei,
  rewardTokenDecimals,
  rewardTokenSymbol,
  privateRewardTokenSymbol,
  swapAmountInput,
  onSwapAmountInputChange,
  swappingTokens,
  swapInputSymbol,
  swapDirection,
  onSwapDirectionChange,
  loadingRewardBalances,
  swapFeeWei,
  swapTokenFeeAmount,
  walletAddress,
  onCotiNetwork,
  hasAesReady,
  onRefreshRewardBalances,
  canSwapRewardTokens,
  swapButtonLabel,
  onSwapRewardTokens,
  swapStatusMessage,
  error
}: TokenSwapPageProps) {
  const swapOutputSymbol = swapDirection === 'shield' ? privateRewardTokenSymbol : rewardTokenSymbol;
  const routeLabel = swapDirection === 'shield' ? 'Public -> Private' : 'Private -> Public';
  const receivePreview = swapAmountInput.trim() ? swapAmountInput : '0';
  const shieldVaultBalanceLabel =
    shieldVaultTokenBalanceWei !== null
      ? `${formatTokenAmount(shieldVaultTokenBalanceWei, rewardTokenDecimals, 6)} ${rewardTokenSymbol}`
      : loadingRewardBalances
        ? 'Loading...'
        : '--';
  const shieldVaultStatusLabel =
    shieldVaultTokenBalanceWei !== null ? 'Live reserve' : loadingRewardBalances ? 'Loading' : 'Unavailable';
  const nativeFeeLabel =
    swapFeeWei !== null ? `${formatCotiAmount(swapFeeWei)} COTI` : loadingRewardBalances ? 'Loading...' : '--';
  const feeQuoteLabel = loadingRewardBalances
    ? 'Loading...'
    : `COTI ${swapFeeWei !== null ? formatCotiAmount(swapFeeWei) : '--'} | ${rewardTokenSymbol} ${
        swapTokenFeeAmount !== null ? formatTokenAmount(swapTokenFeeAmount, rewardTokenDecimals, 6) : '--'
      }`;
  const shieldState = !walletAddress
    ? {
        title: 'Wallet needed',
        description: 'Connect from the header to view balances and use Shield.',
        tone: 'locked'
      }
    : !onCotiNetwork
      ? {
          title: 'Switch to COTI',
          description: 'Use the header wallet control to switch networks before swapping.',
          tone: 'locked'
        }
      : !hasAesReady
        ? {
            title: 'Privacy locked',
            description: 'Unlock privacy from the header before viewing private balances.',
            tone: 'locked'
          }
        : loadingRewardBalances
          ? {
              title: 'Loading balances',
              description: 'Checking wallet balances, Shield reserve, and fee quote.',
              tone: 'loading'
            }
          : shieldVaultTokenBalanceWei === null || swapFeeWei === null || swapTokenFeeAmount === null
            ? {
                title: 'Quote unavailable',
                description: 'Some Shield data did not load. Retry before swapping.',
                tone: 'error'
              }
            : null;

  return (
    <main className="swap-page-shell">
      <section className="swap-page-panel">
        <div className="swap-page-hero">
          <div className="swap-page-heading">
            <h1 className="swap-page-title">Whisper Shield</h1>
            <p>Swap reward tokens between public and private balances on COTI Mainnet.</p>
          </div>
          <div className="swap-balance-pill">
            <span>Balance</span>
            <strong>{tokenToolsSummary}</strong>
          </div>
        </div>

        <div className="swap-card">
          {shieldState ? (
            <div className={`swap-readiness-card swap-readiness-card-${shieldState.tone}`} role="status" aria-live="polite">
              <strong>{shieldState.title}</strong>
              <p>{shieldState.description}</p>
              {shieldState.tone === 'error' ? (
                <button type="button" onClick={onRefreshRewardBalances} disabled={loadingRewardBalances}>
                  {loadingRewardBalances ? 'Retrying...' : 'Retry'}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="swap-field swap-field-route">
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
                Shield
              </button>
              <button
                type="button"
                className={swapDirection === 'unshield' ? 'swap-pill-option active' : 'swap-pill-option'}
                onClick={() => onSwapDirectionChange('unshield')}
                disabled={swappingTokens}
                aria-pressed={swapDirection === 'unshield'}
              >
                Unshield
              </button>
            </div>
          </div>

          <div className="swap-flow">
            <div className="swap-asset-panel">
              <div className="swap-panel-head">
                <span>You pay</span>
                <span>{swapInputSymbol}</span>
              </div>
              <div className="swap-panel-main">
                <label className="swap-label-sr" htmlFor="swap-page-amount-input">
                  Amount
                </label>
                <input
                  id="swap-page-amount-input"
                  type="text"
                  inputMode="decimal"
                  value={swapAmountInput}
                  onChange={(event) => onSwapAmountInputChange(event.target.value)}
                  placeholder="0.0"
                  disabled={swappingTokens}
                />
                <span className="swap-token-chip">{swapInputSymbol}</span>
              </div>
              <p>Wallet: {tokenToolsSummary}</p>
            </div>

            <div className="swap-route-chip">{routeLabel}</div>

            <div className="swap-asset-panel swap-asset-panel-output">
              <div className="swap-panel-head">
                <span>You receive</span>
                <span>Estimated</span>
              </div>
              <div className="swap-panel-main swap-panel-main-readonly">
                <strong>{receivePreview}</strong>
                <span className="swap-token-chip swap-token-chip-output">{swapOutputSymbol}</span>
              </div>
            </div>
          </div>

          <div className="swap-quote-row">
            <span>Fee quote</span>
            <strong>{feeQuoteLabel}</strong>
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

          {swapStatusMessage ? <p className="swap-status-note">{swapStatusMessage}</p> : null}
          {error ? <p className="error swap-error">{error}</p> : null}

          <div className="swap-stats-header">
            <span>Shield vault</span>
            <strong>{shieldVaultStatusLabel}</strong>
          </div>

          <div className="swap-mini-stats">
            <div>
              <span className="reward-line-label">
                Reserve status
                <span
                  className={shieldVaultTokenBalanceWei !== null ? 'reward-state-dot enabled' : 'reward-state-dot'}
                  title={shieldVaultStatusLabel}
                  aria-label={shieldVaultStatusLabel}
                />
              </span>
              <strong>{shieldVaultStatusLabel}</strong>
            </div>
            <div>
              <span>{`${rewardTokenSymbol} in shield vault`}</span>
              <strong>{shieldVaultBalanceLabel}</strong>
            </div>
            <div>
              <span>COTI fee</span>
              <strong>{nativeFeeLabel}</strong>
            </div>
            <div>
              <span>Route</span>
              <strong>{routeLabel}</strong>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
