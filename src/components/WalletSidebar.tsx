import { useEffect, useRef, useState } from 'react';
import {
  formatCotiAmount,
  formatTokenAmount,
  shortenAddress,
  type BurnerWalletRecord,
  type InjectedWalletOption,
  type SwapDirection,
  type SwapFeeModeSelection
} from '../lib/appShared';

type WalletSidebarProps = {
  isConnected: boolean;
  onCotiNetwork: boolean;
  chainId: number | null;
  status: string;
  isStatusConnected: boolean;
  onboardStatus: string;
  isAesConnected: boolean;
  walletAddress: string;
  lastCopiedKey: string | null;
  onCopyWithFeedback: (value: string, feedbackKey: string) => Promise<void>;
  hasSavedBurnerWallet: boolean;
  initializingBurner: boolean;
  burnerStorageBlocked: boolean;
  hasActiveBurnerRecord: boolean;
  onUnlockBurnerWallet: () => void;
  onChangeBurnerPin: () => void;
  onGenerateBurnerWallet: () => void;
  onOpenBurnerImportModal: () => void;
  injectedWalletOptions: InjectedWalletOption[];
  preferredInjectedWalletOption: InjectedWalletOption | null;
  currentInjectedWalletOption: InjectedWalletOption | null;
  activeSignerSource: 'burner' | 'metamask';
  connectionMethod: 'metamask' | null;
  connectingMethod: 'metamask' | null;
  connectingWalletLabel: string;
  savedBurnerWalletCount: number;
  burnerWallets: BurnerWalletRecord[];
  currentBurnerWalletId: string;
  getBurnerWalletDisplayName: (walletRecord: BurnerWalletRecord) => string;
  onConnectInjectedWallet: (walletId?: string) => Promise<void>;
  onSwitchBurnerWallet: (walletId: string) => Promise<void>;
  onDisconnectWallet: () => Promise<void>;
  burnerWalletSelectionValue: string;
  burnerAddress: string;
  topUpAmountWei: bigint | null;
  topUpMultiplier: number;
  onTopUpMultiplierChange: (value: number) => void;
  loadingTopUpQuote: boolean;
  burnerBalanceWei: bigint | null;
  estimatedMessagesLeft: bigint | null;
  topUpAmountLabel: string;
  onTopUpBurnerWithWallet: () => Promise<void>;
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
  burnerNeedsFunding: boolean;
  burnerMnemonicBackup: string;
  showBurnerMnemonic: boolean;
  onBeginRevealBurnerBackup: () => void;
};

export default function WalletSidebar({
  isConnected,
  onCotiNetwork,
  chainId,
  status,
  isStatusConnected,
  onboardStatus,
  isAesConnected,
  walletAddress,
  lastCopiedKey,
  onCopyWithFeedback,
  hasSavedBurnerWallet,
  initializingBurner,
  burnerStorageBlocked,
  hasActiveBurnerRecord,
  onUnlockBurnerWallet,
  onChangeBurnerPin,
  onGenerateBurnerWallet,
  onOpenBurnerImportModal,
  injectedWalletOptions,
  preferredInjectedWalletOption,
  currentInjectedWalletOption,
  activeSignerSource,
  connectionMethod,
  connectingMethod,
  connectingWalletLabel,
  savedBurnerWalletCount,
  burnerWallets,
  currentBurnerWalletId,
  getBurnerWalletDisplayName,
  onConnectInjectedWallet,
  onSwitchBurnerWallet,
  onDisconnectWallet,
  burnerWalletSelectionValue,
  burnerAddress,
  topUpAmountWei,
  topUpMultiplier,
  onTopUpMultiplierChange,
  loadingTopUpQuote,
  burnerBalanceWei,
  estimatedMessagesLeft,
  topUpAmountLabel,
  onTopUpBurnerWithWallet,
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
  burnerNeedsFunding,
  burnerMnemonicBackup,
  showBurnerMnemonic,
  onBeginRevealBurnerBackup
}: WalletSidebarProps) {
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const [showTokenTools, setShowTokenTools] = useState(false);
  const [showBackupTools, setShowBackupTools] = useState(false);
  const walletPickerRef = useRef<HTMLDivElement | null>(null);

  const hasConnectedWallet = walletAddress.length > 0;
  const activeInjectedWalletLabel = currentInjectedWalletOption?.label ?? preferredInjectedWalletOption?.label ?? 'Wallet';
  const shouldHighlightWalletPicker = !hasConnectedWallet && !hasSavedBurnerWallet;
  const walletPrimaryButtonClass = shouldHighlightWalletPicker
    ? 'connect-btn wallet-inline-btn wallet-primary-action'
    : 'connect-btn wallet-inline-btn';
  const shouldOpenWalletPickerFromPrimary =
    hasConnectedWallet ||
    injectedWalletOptions.length > 1 ||
    savedBurnerWalletCount > 1 ||
    (Boolean(preferredInjectedWalletOption) && hasSavedBurnerWallet);
  const walletPrimaryOpensPicker =
    shouldOpenWalletPickerFromPrimary || (!preferredInjectedWalletOption && !hasSavedBurnerWallet);
  const walletPickerButtonLabel =
    connectingMethod === 'metamask'
      ? `Connecting ${connectingWalletLabel || preferredInjectedWalletOption?.label || 'Wallet'}...`
      : !hasConnectedWallet || connectionMethod !== 'metamask'
        ? 'Connect with Wallet'
        : onboardStatus === 'AES key ready'
          ? `${activeInjectedWalletLabel} + AES Ready`
          : 'Sign AES Key';

  useEffect(() => {
    if (swapStatusMessage) {
      setShowTokenTools(true);
    }
  }, [swapStatusMessage]);

  useEffect(() => {
    if (showBurnerMnemonic) {
      setShowBackupTools(true);
    }
  }, [showBurnerMnemonic]);

  useEffect(() => {
    if (!walletPickerOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const targetNode = event.target;
      if (targetNode instanceof Node && !walletPickerRef.current?.contains(targetNode)) {
        setWalletPickerOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setWalletPickerOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [walletPickerOpen]);

  const handleWalletPrimaryAction = () => {
    if (walletPrimaryOpensPicker) {
      setWalletPickerOpen((previous) => !previous);
      return;
    }

    if (preferredInjectedWalletOption) {
      onConnectInjectedWallet(preferredInjectedWalletOption.id).catch(() => {});
      return;
    }

    if (hasSavedBurnerWallet) {
      onUnlockBurnerWallet();
    }
  };

  return (
    <aside className="sidebar">
      <div className="wallet-meta">
        <div className="meta-row">
          <span>Network</span>
          <strong>{onCotiNetwork ? 'COTI' : chainId ? `Chain ${chainId}` : '\u2014'}</strong>
        </div>
        <div className="meta-row">
          <span>Status</span>
          <strong className={isStatusConnected ? 'status-row-value status-with-dot' : 'status-row-value'} title={status}>
            <span className="status-text">{status}</span>
            {isStatusConnected ? <span className="status-dot" aria-hidden="true" /> : null}
          </strong>
        </div>
        <div className="meta-row">
          <span>AES</span>
          <strong className={isAesConnected ? 'status-row-value status-with-dot' : 'status-row-value'} title={onboardStatus}>
            <span className="status-text">{onboardStatus}</span>
            {isAesConnected ? <span className="status-dot" aria-hidden="true" /> : null}
          </strong>
        </div>
        <div className="meta-row">
          <span>Address</span>
          {walletAddress ? (
            <button
              type="button"
              className={
                lastCopiedKey === `wallet-address:${walletAddress.toLowerCase()}`
                  ? 'burner-address-btn copied'
                  : 'burner-address-btn'
              }
              onClick={() => {
                onCopyWithFeedback(walletAddress, `wallet-address:${walletAddress.toLowerCase()}`).catch(() => {});
              }}
              title={walletAddress}
            >
              {lastCopiedKey === `wallet-address:${walletAddress.toLowerCase()}` ? 'Copied' : shortenAddress(walletAddress)}
            </button>
          ) : (
            <strong>{'\u2014'}</strong>
          )}
        </div>
      </div>

      <div className="wallet-meta wallet-actions-card">
        <div className="wallet-section-header">
          <span className="wallet-section-label">Chat wallet</span>
          <span className="wallet-section-hint">{hasSavedBurnerWallet ? 'Wallet saved' : 'No wallet saved'}</span>
        </div>

        <div className="wallet-section-group">
          {!hasSavedBurnerWallet ? (
            <p className="wallet-section-hint wallet-section-hint-note">
              Generate or import a wallet to enable quick connect.
            </p>
          ) : null}

          <div className="wallet-action-grid">
            {hasSavedBurnerWallet ? (
              <button
                className="connect-btn wallet-primary-action wallet-action-span-2"
                onClick={onUnlockBurnerWallet}
                type="button"
                disabled={initializingBurner || burnerStorageBlocked}
              >
                Unlock Wallet
              </button>
            ) : null}

            {hasSavedBurnerWallet ? (
              <button
                className="connect-btn"
                onClick={onChangeBurnerPin}
                type="button"
                disabled={initializingBurner || !hasActiveBurnerRecord}
              >
                Change PIN
              </button>
            ) : null}

            <button
              className={hasSavedBurnerWallet ? 'connect-btn' : 'connect-btn wallet-primary-action'}
              onClick={onGenerateBurnerWallet}
              type="button"
              disabled={initializingBurner || burnerStorageBlocked}
            >
              {initializingBurner ? 'Initializing Wallet...' : 'Generate Wallet'}
            </button>

            <button
              className={hasSavedBurnerWallet ? 'connect-btn' : 'connect-btn wallet-primary-action'}
              onClick={onOpenBurnerImportModal}
              type="button"
              disabled={initializingBurner || burnerStorageBlocked}
            >
              Import Wallet
            </button>
          </div>
        </div>

        <div className="wallet-inline-action">
          <span className="wallet-section-label wallet-section-label-inline">Wallet</span>
          <div className="wallet-inline-control" ref={walletPickerRef}>
            <button
              className={walletPrimaryButtonClass}
              onClick={handleWalletPrimaryAction}
              type="button"
              disabled={connectingMethod !== null}
              aria-expanded={walletPrimaryOpensPicker ? walletPickerOpen : undefined}
              aria-haspopup={walletPrimaryOpensPicker ? 'menu' : undefined}
              title={walletPrimaryOpensPicker ? 'Choose or switch wallet' : undefined}
            >
              {walletPickerButtonLabel}
            </button>
            {walletPickerOpen ? (
              <div className="wallet-picker-menu" role="menu" aria-label="Wallet options">
                <div className="wallet-picker-section">
                  <p className="wallet-picker-heading">Browser wallets</p>
                  {injectedWalletOptions.length > 0 ? (
                    injectedWalletOptions.map((option) => {
                      const isCurrentWallet =
                        activeSignerSource === 'metamask' &&
                        connectionMethod === 'metamask' &&
                        currentInjectedWalletOption?.id === option.id &&
                        isConnected;
                      return (
                        <button
                          key={option.id}
                          className="connect-btn wallet-picker-option"
                          onClick={() => {
                            setWalletPickerOpen(false);
                            onConnectInjectedWallet(option.id).catch(() => {});
                          }}
                          type="button"
                          disabled={connectingMethod !== null}
                          role="menuitem"
                        >
                          <span className="wallet-picker-option-label">{option.label}</span>
                          <span className="wallet-picker-option-meta">{isCurrentWallet ? 'Current' : 'Detected'}</span>
                        </button>
                      );
                    })
                  ) : (
                    <p className="wallet-picker-empty">No browser wallet detected yet.</p>
                  )}
                </div>
                <div className="wallet-picker-section">
                  <p className="wallet-picker-heading">Chat wallets</p>
                  {hasSavedBurnerWallet ? (
                    <button
                      className="connect-btn wallet-picker-option"
                      onClick={() => {
                        setWalletPickerOpen(false);
                        onUnlockBurnerWallet();
                      }}
                      type="button"
                      disabled={initializingBurner || burnerStorageBlocked}
                      role="menuitem"
                    >
                      <span className="wallet-picker-option-label">Unlock saved wallet</span>
                      <span className="wallet-picker-option-meta">{savedBurnerWalletCount} saved</span>
                    </button>
                  ) : (
                    <p className="wallet-picker-empty">No saved chat wallet yet.</p>
                  )}
                  {burnerWallets.map((walletRecord, index) => {
                    const optionName = getBurnerWalletDisplayName(walletRecord);
                    const optionAddress = walletRecord.address ? shortenAddress(walletRecord.address) : 'Unknown';
                    const isCurrentWallet =
                      activeSignerSource === 'burner' &&
                      walletRecord.id &&
                      currentBurnerWalletId === walletRecord.id &&
                      isConnected;
                    return (
                      <button
                        key={walletRecord.id ?? `${walletRecord.privateKey}-${index}`}
                        className="connect-btn wallet-picker-option"
                        onClick={() => {
                          setWalletPickerOpen(false);
                          onSwitchBurnerWallet(walletRecord.id ?? '').catch(() => {});
                        }}
                        type="button"
                        disabled={initializingBurner || !walletRecord.id}
                        role="menuitem"
                      >
                        <span className="wallet-picker-option-label">{`${optionName} (${optionAddress})`}</span>
                        <span className="wallet-picker-option-meta">{isCurrentWallet ? 'Current' : 'Saved'}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="wallet-picker-section">
                  <p className="wallet-picker-heading">New wallet</p>
                  <button
                    className="connect-btn wallet-picker-option"
                    onClick={() => {
                      setWalletPickerOpen(false);
                      onGenerateBurnerWallet();
                    }}
                    type="button"
                    disabled={initializingBurner || burnerStorageBlocked}
                    role="menuitem"
                  >
                    <span className="wallet-picker-option-label">Generate wallet</span>
                  </button>
                  <button
                    className="connect-btn wallet-picker-option"
                    onClick={() => {
                      setWalletPickerOpen(false);
                      onOpenBurnerImportModal();
                    }}
                    type="button"
                    disabled={initializingBurner || burnerStorageBlocked}
                    role="menuitem"
                  >
                    <span className="wallet-picker-option-label">Import wallet</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="wallet-inline-action">
          <span className="wallet-section-label wallet-section-label-inline">Session</span>
          <button
            className="connect-btn wallet-inline-btn"
            onClick={() => {
              onDisconnectWallet().catch(() => {});
            }}
            type="button"
            disabled={!isConnected || connectingMethod !== null}
            title="Disconnects the currently active wallet session."
          >
            Disconnect current wallet
          </button>
        </div>
        {burnerWallets.length > 0 ? (
          <div className="wallet-inline-select">
            <span className="wallet-section-label wallet-section-label-inline">Saved wallets</span>
            <select
              value={burnerWalletSelectionValue}
              onChange={(event) => {
                onSwitchBurnerWallet(event.target.value).catch(() => {});
              }}
              aria-label="Select burner wallet"
              disabled={initializingBurner}
            >
              {burnerWallets.map((walletRecord, index) => {
                const optionAddress = walletRecord.address ? shortenAddress(walletRecord.address) : 'Unknown';
                const optionName = getBurnerWalletDisplayName(walletRecord);
                return (
                  <option key={walletRecord.id ?? `${walletRecord.privateKey}-${index}`} value={walletRecord.id ?? ''}>
                    {`${optionName} (${optionAddress})`}
                  </option>
                );
              })}
            </select>
          </div>
        ) : null}
        {burnerStorageBlocked ? (
          <p className="error">
            Browser storage is blocked. Disable private mode or storage restrictions to persist wallets.
          </p>
        ) : null}
      </div>

      {isConnected ? (
        <div className="wallet-meta topup-meta">
          <div className="wallet-section-header">
            <span className="wallet-section-label">Funding</span>
            <span className="wallet-section-hint">
              {loadingTopUpQuote
                ? 'Calculating...'
                : `${burnerBalanceWei !== null ? formatTokenAmount(burnerBalanceWei, 18, 4) : '--'} COTI | ${
                    estimatedMessagesLeft !== null ? estimatedMessagesLeft.toString() : '--'
                  } msgs left`}
            </span>
          </div>
          <button
            className="connect-btn"
            onClick={() => {
              onTopUpBurnerWithWallet().catch(() => {});
            }}
            type="button"
            disabled={initializingBurner || !burnerAddress || topUpAmountWei === null || topUpAmountWei <= 0n}
          >
            Top Up with Wallet
          </button>
          <input
            className="topup-slider"
            type="range"
            min={0}
            max={100}
            step={1}
            value={topUpMultiplier}
            onChange={(event) => onTopUpMultiplierChange(Number(event.target.value))}
            aria-label="Top up multiplier"
          />
          <p className="topup-estimate-line">
            Approx: <strong>{topUpMultiplier}</strong> msgs = <strong>{topUpAmountLabel}</strong>
          </p>
        </div>
      ) : null}

      {isConnected ? (
        <details
          className="wallet-meta wallet-disclosure wallet-rewards-swap-card"
          open={showTokenTools}
          onToggle={(event) => setShowTokenTools(event.currentTarget.open)}
        >
          <summary>
            <span>Whisper rewards</span>
            <span>{tokenToolsSummary}</span>
          </summary>
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
            ) : null}
            {!groupRewardsContractAddress ? (
              <p className="wallet-section-hint wallet-section-hint-note">
                Rewards contract info is not available for this session yet.
              </p>
            ) : null}
            {rewardsLowReserve ? (
              <p className="wallet-section-hint wallet-section-hint-note">
                Rewards warning: insufficient public token rewards in rewards contract.
              </p>
            ) : null}
            <div className="wallet-section-divider wallet-section-divider-tight" aria-hidden="true" />
            <div className="wallet-section-header wallet-subsection-header">
              <span className="wallet-section-label">Swap</span>
              <span className="wallet-section-hint">{`${rewardTokenSymbol} <-> ${privateRewardTokenSymbol}`}</span>
            </div>
            <div className="swap-field">
              <label className="swap-label-sr" htmlFor="swap-amount-input">
                Amount
              </label>
              <input
                id="swap-amount-input"
                type="text"
                inputMode="decimal"
                value={swapAmountInput}
                onChange={(event) => onSwapAmountInputChange(event.target.value)}
                placeholder={`0.0 ${swapInputSymbol}`}
                disabled={swappingTokens}
              />
            </div>
            <div className="swap-field">
              <span id="swap-direction-label" className="swap-label-sr">
                Swap direction
              </span>
              <div className="swap-pill-switch" role="group" aria-labelledby="swap-direction-label">
                <button
                  type="button"
                  className={swapDirection === 'shield' ? 'swap-pill-option active' : 'swap-pill-option'}
                  onClick={() => onSwapDirectionChange('shield')}
                  disabled={swappingTokens}
                  aria-pressed={swapDirection === 'shield'}
                  title={`${rewardTokenSymbol} to ${privateRewardTokenSymbol}`}
                >
                  {`${rewardTokenSymbol} to ${privateRewardTokenSymbol}`}
                </button>
                <button
                  type="button"
                  className={swapDirection === 'unshield' ? 'swap-pill-option active' : 'swap-pill-option'}
                  onClick={() => onSwapDirectionChange('unshield')}
                  disabled={swappingTokens}
                  aria-pressed={swapDirection === 'unshield'}
                  title={`${privateRewardTokenSymbol} to ${rewardTokenSymbol}`}
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
          </div>
        </details>
      ) : null}

      {burnerNeedsFunding ? <p className="error">Burner needs funding before onboarding.</p> : null}
      {isConnected && burnerMnemonicBackup ? (
        <details
          className="wallet-meta wallet-disclosure"
          open={showBackupTools}
          onToggle={(event) => setShowBackupTools(event.currentTarget.open)}
        >
          <summary>
            <span>Burner backup</span>
            <span>{showBurnerMnemonic ? 'Phrase visible' : 'Phrase hidden'}</span>
          </summary>
          <div className="wallet-disclosure-body">
            <p className="wallet-reminder">Save your seed phrase offline for wallet recovery.</p>
            <button type="button" className="connect-btn wallet-backup-toggle" onClick={onBeginRevealBurnerBackup}>
              {showBurnerMnemonic ? 'Hide phrase' : 'Show phrase'}
            </button>
            {showBurnerMnemonic ? <p className="wallet-secret-phrase">{burnerMnemonicBackup}</p> : null}
          </div>
        </details>
      ) : null}
    </aside>
  );
}
