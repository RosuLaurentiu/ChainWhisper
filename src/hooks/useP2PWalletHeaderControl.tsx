import { useCallback, useMemo, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import AppWalletSwitchButton from '../components/AppWalletSwitchButton';
import WalletHeaderPanel from '../components/WalletHeaderPanel';
import {
  getProviderErrorMessage,
  isWalletAddress,
  parseBurnerWalletStorageState,
  shortenAddress,
  type BurnerWalletRecord,
  type Eip1193Provider,
  type InjectedWalletOption
} from '../lib/appShared';
import {
  resolveWalletModeLabel,
  resolveAppWalletSwitchOptions,
  resolveWalletHeaderActionVisibility,
  resolveWalletHeaderViewModel,
  resolveWalletConnectionPrimaryAction,
  resolveWalletPrimaryButtonClassName,
  resolveWalletPrivacyUnlockPrompt,
  type PrivacyUnlockSnapStatus,
  type SharedWalletSession
} from '../lib/walletSession';
import type { PrivateTokenBalancePrivacyAction } from '../lib/appHelpers';
import type { WalletAesHealthState } from '../lib/cotiAesUnlock';
import { buildMetaMaskMobileDeepLink, isMobileBrowserUserAgent } from '../lib/walletOptions';

type UseP2PWalletHeaderControlArgs = {
  appWalletMenuOpen: boolean;
  beginGenerateBurnerWallet: () => void;
  beginImportBurnerWallet: () => void;
  browserWalletOptions: InjectedWalletOption[];
  burnerWallets: BurnerWalletRecord[];
  chainId: number | null;
  compactMobileWallet?: boolean;
  connectedWalletLabel: string;
  connectedWithBurner: boolean;
  connectingWalletId: string;
  connectBurnerWallet: (walletId?: string) => Promise<void>;
  connectWallet: (walletId?: string, forceAccountPicker?: boolean) => Promise<void>;
  copyWithFeedback: (value: string, feedbackKey: string) => Promise<void>;
  disconnectWallet: () => Promise<void>;
  ensureCotiNetwork: (provider: Eip1193Provider) => Promise<void>;
  getConnectedProvider: () => Eip1193Provider | null;
  hasConnectedAppWallet: boolean;
  hasConnectedBrowserWallet: boolean;
  lastCopiedKey: string | null;
  onOpenContracts?: () => void;
  onCotiNetwork: boolean;
  preferredWalletOption: InjectedWalletOption | null;
  selectedWalletId: string;
  setAppWalletMenuOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedBurnerWalletId: Dispatch<SetStateAction<string>>;
  setWalletError: Dispatch<SetStateAction<string>>;
  setWalletMenuOpen: Dispatch<SetStateAction<boolean>>;
  sharedWalletSession?: SharedWalletSession;
  signAesForCurrentWallet: () => Promise<void>;
  snapAesStatus?: PrivacyUnlockSnapStatus;
  walletAddress: string;
  walletAesHealth?: WalletAesHealthState | null;
  walletHasAes: boolean;
  walletPrivateTokenPrivacyAction?: PrivateTokenBalancePrivacyAction;
  walletMenuOpen: boolean;
};

type UseP2PWalletHeaderControlResult = {
  handleWalletPrimaryAction: () => void;
  tradePrimaryConnectsAppWallet: boolean;
  tradeWalletHeaderControl: ReactNode;
  walletPrimaryButtonLabel: string;
};

export default function useP2PWalletHeaderControl({
  appWalletMenuOpen,
  beginGenerateBurnerWallet,
  beginImportBurnerWallet,
  browserWalletOptions,
  burnerWallets,
  chainId,
  compactMobileWallet = false,
  connectedWalletLabel,
  connectedWithBurner,
  connectingWalletId,
  connectBurnerWallet,
  connectWallet,
  copyWithFeedback,
  disconnectWallet,
  ensureCotiNetwork,
  getConnectedProvider,
  hasConnectedAppWallet,
  hasConnectedBrowserWallet,
  lastCopiedKey,
  onOpenContracts,
  onCotiNetwork,
  preferredWalletOption,
  selectedWalletId,
  setAppWalletMenuOpen,
  setSelectedBurnerWalletId,
  setWalletError,
  setWalletMenuOpen,
  sharedWalletSession,
  signAesForCurrentWallet,
  snapAesStatus = 'unknown',
  walletAddress,
  walletAesHealth = null,
  walletHasAes,
  walletPrivateTokenPrivacyAction = 'none',
  walletMenuOpen
}: UseP2PWalletHeaderControlArgs): UseP2PWalletHeaderControlResult {
  const walletKey = walletAddress.trim().toLowerCase();
  const visibleAppWallets = sharedWalletSession?.burnerWallets?.length
    ? sharedWalletSession.burnerWallets
    : burnerWallets;
  const getTradeAppWalletDisplayName = useCallback(
    (walletRecord: BurnerWalletRecord, index: number): string =>
      walletRecord.name?.trim() || (walletRecord.address ? shortenAddress(walletRecord.address) : `Wallet ${index + 1}`),
    []
  );
  const handleSwitchTradeAppWallet = useCallback(
    (walletIdOrAddress: string) => {
      const walletSelector = walletIdOrAddress.trim();
      const walletSelectorKey = walletSelector.toLowerCase();
      const selectedWalletRecord = visibleAppWallets.find(
        (walletRecord) =>
          walletRecord.id === walletSelector || walletRecord.address?.toLowerCase() === walletSelectorKey
      );
      const selectedWalletKey = selectedWalletRecord?.address?.toLowerCase() ?? '';
      const selectorIsCurrentAddress = isWalletAddress(walletSelector) && walletSelectorKey === walletKey;
      if (
        !walletSelector ||
        (connectedWithBurner && (selectorIsCurrentAddress || selectedWalletKey === walletKey))
      ) {
        return;
      }

      setWalletMenuOpen(false);
      setAppWalletMenuOpen(false);
      setSelectedBurnerWalletId(walletSelector);
      connectBurnerWallet(walletSelector).catch(() => {});
    },
    [
      connectBurnerWallet,
      connectedWithBurner,
      setAppWalletMenuOpen,
      setSelectedBurnerWalletId,
      setWalletMenuOpen,
      visibleAppWallets,
      walletKey
    ]
  );
  const tradeHasSavedAppWallet = burnerWallets.length > 0 || parseBurnerWalletStorageState().kind !== 'none';
  const isMobileBrowser = isMobileBrowserUserAgent();
  const canUseMobileWalletHandoff = isMobileBrowser || compactMobileWallet;
  const walletConnectionBusy = Boolean(connectingWalletId && connectingWalletId !== 'aes');
  const tradeWalletBusyLabel = walletConnectionBusy
    ? connectingWalletId === 'burner'
      ? 'Unlocking...'
      : 'Connecting...'
    : undefined;
  const walletPrimaryAction = resolveWalletConnectionPrimaryAction({
    busyLabel: tradeWalletBusyLabel,
    hasSavedAppWallet: tradeHasSavedAppWallet,
    isMobileBrowser: canUseMobileWalletHandoff,
    onCotiNetwork,
    policy: 'browser-first',
    preferredBrowserWalletId: preferredWalletOption?.id,
    preferredBrowserWalletLabel: preferredWalletOption?.label,
    walletAddress
  });
  const walletPrimaryButtonLabel = walletPrimaryAction.label;
  const tradePrimaryConnectsAppWallet = walletPrimaryAction.kind === 'connect-app-wallet';
  const showMobileBrowserWalletOpenAction = walletPrimaryAction.kind === 'open-browser-wallet-app';
  const showTradeDisconnectedAppAction = Boolean(!walletAddress && tradeHasSavedAppWallet);
  const walletAddressCopyKey = walletAddress ? `trade-wallet-address:${walletAddress.toLowerCase()}` : '';
  const handleWalletPrimaryAction = useCallback(() => {
    switch (walletPrimaryAction.kind) {
      case 'switch-network': {
        const provider = getConnectedProvider();
        if (provider) {
          ensureCotiNetwork(provider).catch((error) => {
            setWalletError(getProviderErrorMessage(error, 'Failed to switch network.'));
          });
        }
        return;
      }
      case 'copy-address':
        copyWithFeedback(walletAddress, walletAddressCopyKey).catch(() => {});
        return;
      case 'connect-app-wallet':
        connectBurnerWallet().catch(() => {});
        return;
      case 'generate-app-wallet':
        beginGenerateBurnerWallet();
        return;
      case 'open-browser-wallet-app':
        window.location.href = buildMetaMaskMobileDeepLink();
        return;
      case 'connect-browser-wallet':
        connectWallet(walletPrimaryAction.browserWalletId).catch(() => {});
        return;
      default:
        return;
    }
  }, [
    beginGenerateBurnerWallet,
    connectBurnerWallet,
    connectWallet,
    copyWithFeedback,
    ensureCotiNetwork,
    getConnectedProvider,
    setWalletError,
    walletAddress,
    walletAddressCopyKey,
    walletPrimaryAction.browserWalletId,
    walletPrimaryAction.kind
  ]);
  const walletPrimaryButtonCopied = lastCopiedKey === walletAddressCopyKey;
  const walletPrimaryButtonClass = resolveWalletPrimaryButtonClassName({
    copied: walletPrimaryButtonCopied,
    onCotiNetwork,
    walletAddress
  });
  const walletPrimaryButtonIsAddress = Boolean(walletAddress && onCotiNetwork);
  const walletNeedsPrivateTokenSetup = walletPrivateTokenPrivacyAction === 'setup';
  const walletNeedsPrivateTokenPrivacyAction = walletPrivateTokenPrivacyAction !== 'none';
  const walletKind = !walletAddress ? 'none' : connectedWithBurner ? 'app' : 'browser';
  const headerModel = resolveWalletHeaderViewModel({
    chainId,
    hasAesReady: walletHasAes,
    policy: 'browser-first',
    privateTokenPrivacyAction: walletPrivateTokenPrivacyAction,
    snapStatus: snapAesStatus,
    unlocking: connectingWalletId === 'aes',
    walletAesHealth,
    walletAddress,
    walletKind
  });
  const effectiveSnapAesStatus: PrivacyUnlockSnapStatus = headerModel.effectiveSnapStatus;
  const walletNeedsPrivacyRepair =
    walletAesHealth?.status === 'repair-needed' ||
    walletAesHealth?.status === 'key-mismatch' ||
    effectiveSnapAesStatus === 'repair-needed' ||
    effectiveSnapAesStatus === 'key-mismatch' ||
    effectiveSnapAesStatus === 'installed-aes-stale';
  const privacyDisplay = headerModel.privacyDisplay;
  const walletModeLabel = resolveWalletModeLabel({
    appWithBrowserLabel: 'browser',
    browserWalletLabel: connectedWalletLabel,
    connectedWithAppWallet: connectedWithBurner,
    hasAppWalletAvailable: hasConnectedAppWallet,
    hasBrowserWalletAvailable: hasConnectedBrowserWallet,
    walletAddress
  });
  const walletStatusLabel = privacyDisplay.statusLabel;
  const walletStatusTone = privacyDisplay.statusTone;
  const tradeWalletActions = useMemo(
    () =>
      resolveWalletHeaderActionVisibility({
        appWalletCount: visibleAppWallets.length,
        browserWalletOptions,
        connectedWithAppWallet: connectedWithBurner,
        hasSavedAppWallet: tradeHasSavedAppWallet,
        isConnected: Boolean(walletAddress),
        isOnCotiNetwork: onCotiNetwork,
        preferredBrowserWalletId: preferredWalletOption?.id,
        showDisconnectedBrowserAction: Boolean(!walletAddress && preferredWalletOption)
      }),
    [
      browserWalletOptions,
      connectedWithBurner,
      onCotiNetwork,
      preferredWalletOption?.id,
      tradeHasSavedAppWallet,
      visibleAppWallets.length,
      walletAddress
    ]
  );
  const {
    menuBrowserWalletOptions: tradeMenuBrowserWalletOptions,
    showAppCreateAction: showTradeAppCreateAction,
    showAppSwitchAction: showTradeAppSwitchAction,
    showAppWalletSwitchButton: showTradeAppWalletSwitchButton,
    showBrowserQuickAction: showTradeBrowserQuickAction,
    showBrowserWalletMenuSection: showTradeBrowserWalletMenuSection
  } = tradeWalletActions;
  const mobileAppWalletSwitchOptions = useMemo(
    () =>
      compactMobileWallet
        ? resolveAppWalletSwitchOptions({
          activeWalletAddress: walletAddress,
          disabled: Boolean(connectingWalletId),
          getDisplayName: getTradeAppWalletDisplayName,
          wallets: visibleAppWallets
        })
        : [],
    [compactMobileWallet, connectingWalletId, getTradeAppWalletDisplayName, visibleAppWallets, walletAddress]
  );
  const visibleTradeMenuBrowserWalletOptions =
    compactMobileWallet && walletAddress ? browserWalletOptions : tradeMenuBrowserWalletOptions;
  const visibleShowTradeBrowserWalletMenuSection =
    compactMobileWallet && walletAddress
      ? browserWalletOptions.length > 0
      : showTradeBrowserWalletMenuSection;
  const tradeAppWalletSwitchButton = showTradeAppWalletSwitchButton && !showTradeDisconnectedAppAction && !compactMobileWallet ? (
    <AppWalletSwitchButton
      menuOpen={appWalletMenuOpen}
      onToggleMenu={() => {
        setWalletMenuOpen(false);
        setAppWalletMenuOpen((previous) => !previous);
      }}
      onSelectWallet={(option) => handleSwitchTradeAppWallet(option.address || option.walletId || option.id)}
      options={resolveAppWalletSwitchOptions({
        activeWalletAddress: walletAddress,
        disabled: Boolean(connectingWalletId),
        getDisplayName: getTradeAppWalletDisplayName,
        wallets: visibleAppWallets
      })}
      disabled={Boolean(connectingWalletId)}
    />
  ) : null;
  const showTradePrivacyStatusAction = headerModel.showPrivacyAction;
  const tradePrivacyPrompt =
    walletNeedsPrivateTokenPrivacyAction && walletHasAes
      ? {
          label: connectingWalletId === 'aes'
            ? walletNeedsPrivateTokenSetup
              ? 'Setting up...'
              : 'Refreshing...'
            : walletNeedsPrivateTokenSetup
              ? 'Set up tokens'
              : 'Refresh privacy',
          title:
            connectingWalletId === 'aes'
              ? 'Check your wallet prompt to finish the private token privacy action.'
              : walletNeedsPrivateTokenSetup
                ? 'Set up latest PrivateERC20 balance visibility for this wallet.'
                : 'Refresh this wallet privacy key or private-token balance visibility.'
        }
      : resolveWalletPrivacyUnlockPrompt({
          hasAesReady: walletHasAes && !walletNeedsPrivacyRepair,
          snapStatus: walletNeedsPrivacyRepair ? 'repair-needed' : effectiveSnapAesStatus,
          unlocking: connectingWalletId === 'aes'
        });
  const tradeWalletSwitchAction = useMemo(() => {
    if (compactMobileWallet) {
      return null;
    }

    if (showTradeDisconnectedAppAction) {
      const actionLabel = tradeHasSavedAppWallet ? 'App wallet' : 'Add app wallet';
      return (
        <button
          type="button"
          className="p2p-wallet-aes-action wallet-app-secondary-action"
          onClick={() => {
            if (tradeHasSavedAppWallet) {
              connectBurnerWallet().catch(() => {});
              return;
            }
            beginGenerateBurnerWallet();
          }}
          disabled={Boolean(connectingWalletId)}
          title={tradeHasSavedAppWallet ? 'Use the app wallet for this app' : 'Create an app wallet for this app'}
        >
          {connectingWalletId === 'burner' ? 'Unlocking...' : actionLabel}
        </button>
      );
    }

    if (showTradeBrowserQuickAction && preferredWalletOption) {
      return (
        <button
          type="button"
          className="p2p-wallet-aes-action wallet-switch-action"
          onClick={() => connectWallet(preferredWalletOption.id).catch(() => {})}
          disabled={Boolean(connectingWalletId)}
          title={`Use ${preferredWalletOption.label} for this app`}
        >
          {preferredWalletOption.label}
        </button>
      );
    }

    if (showTradeAppSwitchAction) {
      return (
        <button
          type="button"
          className="p2p-wallet-aes-action wallet-switch-action"
          onClick={() => connectBurnerWallet().catch(() => {})}
          disabled={Boolean(connectingWalletId)}
          title="Use the app wallet for this app"
        >
          App wallet
        </button>
      );
    }

    if (showTradeAppCreateAction) {
      return (
        <button
          type="button"
          className="p2p-wallet-aes-action wallet-switch-action"
          onClick={beginGenerateBurnerWallet}
          disabled={Boolean(connectingWalletId)}
          title="Create an app wallet so you can switch between wallet types"
        >
          Add app wallet
        </button>
      );
    }

    return null;
  }, [
    beginGenerateBurnerWallet,
    connectBurnerWallet,
    connectWallet,
    connectingWalletId,
    compactMobileWallet,
    preferredWalletOption,
    showTradeAppCreateAction,
    showTradeAppSwitchAction,
    showTradeBrowserQuickAction,
    showTradeDisconnectedAppAction,
    tradeHasSavedAppWallet
  ]);
  const tradeWalletHeaderControl = useMemo(
    () => (
      <WalletHeaderPanel
        primaryButtonClassName={walletPrimaryButtonClass}
        primaryButtonLabel={walletPrimaryButtonLabel}
        primaryAddon={tradeAppWalletSwitchButton}
        primaryMetaLabel={walletPrimaryButtonIsAddress && walletPrimaryButtonCopied ? 'Copied' : undefined}
        primaryButtonTitle={walletAddress ? `Copy wallet address (${walletAddress})` : undefined}
        primaryDisabled={walletPrimaryAction.disabled}
        onPrimaryAction={handleWalletPrimaryAction}
        modeLabel={walletModeLabel}
        statusLabel={walletStatusLabel}
        statusTone={walletStatusTone}
        statusActionDisabled={Boolean(connectingWalletId)}
        statusActionLabel={
          showTradePrivacyStatusAction ? privacyDisplay.actionLabel ?? tradePrivacyPrompt.label : undefined
        }
        statusActionTitle={
          showTradePrivacyStatusAction ? privacyDisplay.actionTitle ?? tradePrivacyPrompt.title : undefined
        }
        onStatusAction={
          showTradePrivacyStatusAction
            ? () => {
                signAesForCurrentWallet().catch(() => {});
              }
            : undefined
        }
        action={tradeWalletSwitchAction ? <>{tradeWalletSwitchAction}</> : null}
        menuOpen={walletMenuOpen}
        onToggleMenu={() => {
          setAppWalletMenuOpen(false);
          setWalletMenuOpen((previous) => !previous);
        }}
        menuDisabled={Boolean(connectingWalletId)}
        menu={
          <>
            {visibleShowTradeBrowserWalletMenuSection ? (
              <div className="p2p-wallet-menu-section">
                <span>Browser wallet</span>
                {visibleTradeMenuBrowserWalletOptions.length > 0 ? (
                  visibleTradeMenuBrowserWalletOptions.map((option) => {
                    const isCurrentBrowserWallet =
                      !connectedWithBurner && walletAddress && option.id === (selectedWalletId || preferredWalletOption?.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={isCurrentBrowserWallet ? 'p2p-wallet-action active' : 'p2p-wallet-action'}
                        onClick={() => {
                          setWalletMenuOpen(false);
                          connectWallet(option.id, true).catch(() => {});
                        }}
                        disabled={Boolean(connectingWalletId)}
                        role="menuitem"
                      >
                        {connectingWalletId === option.id ? 'Connecting...' : option.label}
                      </button>
                    );
                  })
                ) : (
                  <button
                    type="button"
                    className="p2p-wallet-action"
                    onClick={() => {
                      if (showMobileBrowserWalletOpenAction) {
                        window.location.href = buildMetaMaskMobileDeepLink();
                      }
                    }}
                    disabled={!showMobileBrowserWalletOpenAction}
                    role="menuitem"
                  >
                    {showMobileBrowserWalletOpenAction
                      ? 'Open MetaMask Mobile'
                      : 'MetaMask or CipherTrade not detected'}
                  </button>
                )}
              </div>
            ) : null}

            <div className="p2p-wallet-menu-section">
              <span>App wallet</span>
              {compactMobileWallet && mobileAppWalletSwitchOptions.length > 0
                ? mobileAppWalletSwitchOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={option.active ? 'p2p-wallet-action active' : 'p2p-wallet-action'}
                    onClick={() => handleSwitchTradeAppWallet(option.address || option.walletId || option.id)}
                    disabled={option.disabled}
                    role="menuitem"
                  >
                    {option.label}
                  </button>
                ))
                : (
                  <button
                    type="button"
                    className={connectedWithBurner ? 'p2p-wallet-action active' : 'p2p-wallet-action'}
                    onClick={() => {
                      setWalletMenuOpen(false);
                      if (tradeHasSavedAppWallet) {
                        connectBurnerWallet().catch(() => {});
                      }
                    }}
                    disabled={Boolean(connectingWalletId) || !tradeHasSavedAppWallet}
                    role="menuitem"
                  >
                    {connectingWalletId === 'burner'
                      ? 'Unlocking...'
                      : tradeHasSavedAppWallet
                        ? 'Connect app wallet'
                        : 'No saved app wallet'}
                  </button>
                )}
              <button type="button" className="p2p-wallet-action" onClick={beginGenerateBurnerWallet} role="menuitem">
                Generate wallet
              </button>
              <button type="button" className="p2p-wallet-action" onClick={beginImportBurnerWallet} role="menuitem">
                Import wallet
              </button>
            </div>

            {compactMobileWallet && onOpenContracts ? (
              <div className="p2p-wallet-menu-section">
                <span>Utilities</span>
                <button
                  type="button"
                  className="p2p-wallet-action"
                  onClick={() => {
                    setWalletMenuOpen(false);
                    onOpenContracts();
                  }}
                  role="menuitem"
                >
                  Contracts
                </button>
              </div>
            ) : null}

            <button
              type="button"
              className="p2p-wallet-action danger"
              onClick={() => {
                setWalletMenuOpen(false);
                disconnectWallet().catch(() => {});
              }}
              disabled={Boolean(connectingWalletId) || !walletAddress}
              role="menuitem"
            >
              Disconnect
            </button>
          </>
        }
      />
    ),
    [
      beginGenerateBurnerWallet,
      beginImportBurnerWallet,
      browserWalletOptions,
      connectBurnerWallet,
      connectWallet,
      connectedWithBurner,
      connectedWalletLabel,
      connectingWalletId,
      compactMobileWallet,
      disconnectWallet,
      handleSwitchTradeAppWallet,
      handleWalletPrimaryAction,
      mobileAppWalletSwitchOptions,
      onOpenContracts,
      preferredWalletOption,
      selectedWalletId,
      setAppWalletMenuOpen,
      setWalletMenuOpen,
      showMobileBrowserWalletOpenAction,
      signAesForCurrentWallet,
      tradeAppWalletSwitchButton,
      tradePrivacyPrompt.label,
      tradePrivacyPrompt.title,
      tradePrimaryConnectsAppWallet,
      tradeWalletSwitchAction,
      visibleShowTradeBrowserWalletMenuSection,
      visibleTradeMenuBrowserWalletOptions,
      walletAddress,
      walletAesHealth,
      walletMenuOpen,
      walletModeLabel,
      walletPrimaryButtonClass,
      walletPrimaryButtonCopied,
      walletPrimaryButtonIsAddress,
      walletPrimaryButtonLabel,
      walletPrimaryAction.disabled,
      walletStatusLabel,
      walletStatusTone,
      walletConnectionBusy,
      privacyDisplay.actionLabel,
      privacyDisplay.actionTitle,
      effectiveSnapAesStatus,
      showTradePrivacyStatusAction
    ]
  );

  return {
    handleWalletPrimaryAction,
    tradePrimaryConnectsAppWallet,
    tradeWalletHeaderControl,
    walletPrimaryButtonLabel
  };
}
