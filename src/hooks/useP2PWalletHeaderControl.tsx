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
  resolveWalletPrimaryButtonClassName,
  resolveWalletPrimaryButtonLabel,
  resolveWalletPrivacyActionLabel,
  resolveWalletReadiness,
  type SharedWalletSession
} from '../lib/walletSession';

type UseP2PWalletHeaderControlArgs = {
  appWalletMenuOpen: boolean;
  beginGenerateBurnerWallet: () => void;
  beginImportBurnerWallet: () => void;
  browserWalletOptions: InjectedWalletOption[];
  burnerWallets: BurnerWalletRecord[];
  chainId: number | null;
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
  onCotiNetwork: boolean;
  preferredWalletOption: InjectedWalletOption | null;
  selectedWalletId: string;
  setAppWalletMenuOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedBurnerWalletId: Dispatch<SetStateAction<string>>;
  setWalletError: Dispatch<SetStateAction<string>>;
  setWalletMenuOpen: Dispatch<SetStateAction<boolean>>;
  sharedWalletSession?: SharedWalletSession;
  signAesForCurrentWallet: () => Promise<void>;
  walletAddress: string;
  walletHasAes: boolean;
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
  onCotiNetwork,
  preferredWalletOption,
  selectedWalletId,
  setAppWalletMenuOpen,
  setSelectedBurnerWalletId,
  setWalletError,
  setWalletMenuOpen,
  sharedWalletSession,
  signAesForCurrentWallet,
  walletAddress,
  walletHasAes,
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
  const tradePrimaryConnectsAppWallet = !walletAddress && tradeHasSavedAppWallet && !preferredWalletOption;
  const showTradeDisconnectedAppAction = Boolean(!walletAddress && preferredWalletOption);
  const tradeWalletBusyLabel =
    connectingWalletId === 'aes'
      ? 'Unlocking...'
      : connectingWalletId
        ? 'Connecting...'
        : undefined;
  const walletPrimaryButtonLabel = resolveWalletPrimaryButtonLabel({
    busyLabel: tradeWalletBusyLabel,
    connectLabel: tradePrimaryConnectsAppWallet
      ? 'Connect app wallet'
      : preferredWalletOption
        ? `Connect ${preferredWalletOption.label}`
        : 'Wallet unavailable',
    onCotiNetwork,
    walletAddress
  });
  const walletAddressCopyKey = walletAddress ? `trade-wallet-address:${walletAddress.toLowerCase()}` : '';
  const handleWalletPrimaryAction = useCallback(() => {
    if (walletAddress && !onCotiNetwork) {
      const provider = getConnectedProvider();
      if (provider) {
        ensureCotiNetwork(provider).catch((error) => {
          setWalletError(getProviderErrorMessage(error, 'Failed to switch network.'));
        });
      }
      return;
    }

    if (walletAddress) {
      copyWithFeedback(walletAddress, walletAddressCopyKey).catch(() => {});
      return;
    }

    if (tradePrimaryConnectsAppWallet) {
      connectBurnerWallet().catch(() => {});
      return;
    }

    connectWallet(preferredWalletOption?.id).catch(() => {});
  }, [
    connectBurnerWallet,
    connectWallet,
    copyWithFeedback,
    ensureCotiNetwork,
    getConnectedProvider,
    onCotiNetwork,
    preferredWalletOption?.id,
    setWalletError,
    tradePrimaryConnectsAppWallet,
    walletAddress,
    walletAddressCopyKey
  ]);
  const walletPrimaryButtonCopied = lastCopiedKey === walletAddressCopyKey;
  const walletPrimaryButtonClass = resolveWalletPrimaryButtonClassName({
    copied: walletPrimaryButtonCopied,
    onCotiNetwork,
    walletAddress
  });
  const walletPrimaryButtonIsAddress = Boolean(walletAddress && onCotiNetwork);
  const showInlineAesAction = Boolean(walletAddress && onCotiNetwork && !walletHasAes);
  const walletReadiness = resolveWalletReadiness({
    chainId,
    hasAesReady: walletHasAes,
    walletAddress
  });
  const walletModeLabel = resolveWalletModeLabel({
    appWithBrowserLabel: 'browser',
    browserWalletLabel: connectedWalletLabel,
    connectedWithAppWallet: connectedWithBurner,
    hasAppWalletAvailable: hasConnectedAppWallet,
    hasBrowserWalletAvailable: hasConnectedBrowserWallet,
    walletAddress
  });
  const walletStatusLabel = walletReadiness.statusLabel;
  const walletStatusTone = walletReadiness.statusTone;
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
  const tradeAppWalletSwitchButton = showTradeAppWalletSwitchButton && !showTradeDisconnectedAppAction ? (
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
  const tradePrivacyActionLabel = resolveWalletPrivacyActionLabel(connectingWalletId === 'aes');
  const tradeWalletSwitchAction = useMemo(() => {
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
        primaryDisabled={
          Boolean(connectingWalletId) || (!walletAddress && !preferredWalletOption && !tradePrimaryConnectsAppWallet)
        }
        onPrimaryAction={handleWalletPrimaryAction}
        modeLabel={walletModeLabel}
        statusLabel={walletStatusLabel}
        statusTone={walletStatusTone}
        statusActionDisabled={Boolean(connectingWalletId)}
        statusActionLabel={showInlineAesAction ? tradePrivacyActionLabel : undefined}
        statusActionTitle="Run COTI onboarding once so encrypted balances and private messaging features can work."
        onStatusAction={
          showInlineAesAction
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
            {showTradeBrowserWalletMenuSection ? (
              <div className="p2p-wallet-menu-section">
                <span>Browser wallet</span>
                {tradeMenuBrowserWalletOptions.length > 0 ? (
                  tradeMenuBrowserWalletOptions.map((option) => {
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
                  <button type="button" className="p2p-wallet-action" disabled role="menuitem">
                    MetaMask or CipherTrade not detected
                  </button>
                )}
              </div>
            ) : null}

            <div className="p2p-wallet-menu-section">
              <span>App wallet</span>
              <button
                type="button"
                className={connectedWithBurner ? 'p2p-wallet-action active' : 'p2p-wallet-action'}
                onClick={() => {
                  setWalletMenuOpen(false);
                  connectBurnerWallet().catch(() => {});
                }}
                disabled={Boolean(connectingWalletId)}
                role="menuitem"
              >
                {connectingWalletId === 'burner' ? 'Unlocking...' : 'Connect app wallet'}
              </button>
              <button type="button" className="p2p-wallet-action" onClick={beginGenerateBurnerWallet} role="menuitem">
                Generate wallet
              </button>
              <button type="button" className="p2p-wallet-action" onClick={beginImportBurnerWallet} role="menuitem">
                Import wallet
              </button>
            </div>

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
      connectingWalletId,
      disconnectWallet,
      handleSwitchTradeAppWallet,
      handleWalletPrimaryAction,
      preferredWalletOption,
      selectedWalletId,
      setAppWalletMenuOpen,
      setWalletMenuOpen,
      showInlineAesAction,
      signAesForCurrentWallet,
      tradeAppWalletSwitchButton,
      tradeMenuBrowserWalletOptions,
      tradePrivacyActionLabel,
      tradePrimaryConnectsAppWallet,
      tradeWalletSwitchAction,
      showTradeBrowserWalletMenuSection,
      walletAddress,
      walletMenuOpen,
      walletModeLabel,
      walletPrimaryButtonClass,
      walletPrimaryButtonCopied,
      walletPrimaryButtonIsAddress,
      walletPrimaryButtonLabel,
      walletStatusLabel,
      walletStatusTone
    ]
  );

  return {
    handleWalletPrimaryAction,
    tradePrimaryConnectsAppWallet,
    tradeWalletHeaderControl,
    walletPrimaryButtonLabel
  };
}
