import { useCallback, useMemo, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { Wallet } from '@coti-io/coti-ethers';
import AppWalletSwitchButton from '../components/AppWalletSwitchButton';
import WalletHeaderPanel from '../components/WalletHeaderPanel';
import {
  getProviderErrorMessage,
  type BurnerInitMode,
  type BurnerWalletRecord,
  type Eip1193Provider,
  type InjectedWalletOption,
  type SignerSource
} from '../lib/appShared';
import {
  filterAllowedBrowserWalletOptions,
  getPreferredInjectedWalletOption,
  orderInjectedWalletOptions
} from '../lib/walletOptions';
import {
  resolveWalletModeLabel,
  resolveWalletPrimaryButtonClassName,
  resolveWalletPrimaryButtonLabel,
  resolveWalletPrivacyActionLabel,
  resolveWalletReadiness
} from '../lib/walletSession';
import type { BrowserWalletSession } from './useWalletOnboarding';

type BrowserWalletActivationOptions = {
  preparePrivacy?: boolean;
};

type UseChatWalletHeaderControlArgs = {
  activeSignerSource: SignerSource;
  appWallet: Wallet | null;
  activateBrowserWalletSession: (walletId?: string, options?: BrowserWalletActivationOptions) => Promise<unknown>;
  beginBurnerPinFlow: (mode: BurnerInitMode) => Promise<void>;
  beginRevealBurnerBackup: () => void;
  browserWalletSession: BrowserWalletSession | null;
  burnerAddress: string;
  burnerMnemonicBackup: string;
  burnerRecordReady: boolean;
  burnerStorageBlocked: boolean;
  burnerWallets: BurnerWalletRecord[];
  chainId: number | null;
  chatAppWalletMenuOpen: boolean;
  chatWalletMenuOpen: boolean;
  connectingMethod: 'metamask' | null;
  connectingWalletLabel: string;
  connectionMethod: 'metamask' | null;
  copyWithFeedback: (value: string, feedbackKey: string) => Promise<void>;
  currentInjectedWalletOption: InjectedWalletOption | null;
  disconnectWallet: () => Promise<void>;
  ensureCotiNetwork: (provider: Eip1193Provider) => Promise<void>;
  getBurnerWalletDisplayName: (walletRecord: BurnerWalletRecord) => string;
  getConnectedProvider: () => Eip1193Provider | null;
  handleSwitchActiveBurnerWallet: (walletId: string) => Promise<void> | void;
  hasAesReady: boolean;
  hasSavedBurnerWallet: boolean;
  injectedWalletOptions: InjectedWalletOption[];
  initializingBurner: boolean;
  isConnected: boolean;
  lastCopiedKey: string | null;
  loadingTopUpQuote: boolean;
  onCotiNetwork: boolean;
  openChangeBurnerPin: () => void;
  preferredBrowserWalletId: string;
  preferredInjectedWalletOption: InjectedWalletOption | null;
  setChatAppWalletMenuOpen: Dispatch<SetStateAction<boolean>>;
  setChatWalletMenuOpen: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setShowBurnerImportModal: Dispatch<SetStateAction<boolean>>;
  setShowTopUpModal: Dispatch<SetStateAction<boolean>>;
  topUpAmountLabel: string;
  topUpAmountWei: bigint | null;
  walletAddress: string;
};

type UseChatWalletHeaderControlResult = {
  chatPreferredBrowserWalletOption: InjectedWalletOption | null;
  chatWalletHeaderControl: ReactNode;
  chatWarmAppWallet: Wallet | null;
};

export default function useChatWalletHeaderControl({
  activeSignerSource,
  appWallet,
  activateBrowserWalletSession,
  beginBurnerPinFlow,
  beginRevealBurnerBackup,
  browserWalletSession,
  burnerAddress,
  burnerMnemonicBackup,
  burnerRecordReady,
  burnerStorageBlocked,
  burnerWallets,
  chainId,
  chatAppWalletMenuOpen,
  chatWalletMenuOpen,
  connectingMethod,
  connectingWalletLabel,
  connectionMethod,
  copyWithFeedback,
  currentInjectedWalletOption,
  disconnectWallet,
  ensureCotiNetwork,
  getBurnerWalletDisplayName,
  getConnectedProvider,
  handleSwitchActiveBurnerWallet,
  hasAesReady,
  hasSavedBurnerWallet,
  injectedWalletOptions,
  initializingBurner,
  isConnected,
  lastCopiedKey,
  loadingTopUpQuote,
  onCotiNetwork,
  openChangeBurnerPin,
  preferredBrowserWalletId,
  preferredInjectedWalletOption,
  setChatAppWalletMenuOpen,
  setChatWalletMenuOpen,
  setError,
  setShowBurnerImportModal,
  setShowTopUpModal,
  topUpAmountLabel,
  topUpAmountWei,
  walletAddress
}: UseChatWalletHeaderControlArgs): UseChatWalletHeaderControlResult {
  const allowedChatBrowserWalletOptions = useMemo(
    () => filterAllowedBrowserWalletOptions(injectedWalletOptions),
    [injectedWalletOptions]
  );
  const chatPreferredBrowserWalletOption = useMemo(
    () => getPreferredInjectedWalletOption(allowedChatBrowserWalletOptions, preferredBrowserWalletId, 'metamask'),
    [allowedChatBrowserWalletOptions, preferredBrowserWalletId]
  );
  const chatBrowserWalletSortId = currentInjectedWalletOption?.id ?? preferredBrowserWalletId;
  const orderedChatInjectedWalletOptions = useMemo(
    () => orderInjectedWalletOptions(allowedChatBrowserWalletOptions, chatBrowserWalletSortId, 'metamask'),
    [allowedChatBrowserWalletOptions, chatBrowserWalletSortId]
  );

  const chatWalletAddressCopyKey = walletAddress ? `wallet-address:${walletAddress.toLowerCase()}` : '';
  const chatWalletIsAppWallet = isConnected && activeSignerSource === 'burner';
  const chatPrimaryConnectsBrowserWallet = !walletAddress && burnerStorageBlocked && Boolean(chatPreferredBrowserWalletOption);
  const chatWalletPrimaryConnectLabel =
    chatPrimaryConnectsBrowserWallet && chatPreferredBrowserWalletOption
      ? `Connect ${chatPreferredBrowserWalletOption.label}`
      : burnerStorageBlocked
        ? 'Wallet unavailable'
        : hasSavedBurnerWallet
          ? 'Connect app wallet'
          : 'Generate app wallet';
  const chatWalletBusyLabel =
    connectingMethod === 'metamask'
      ? `Connecting ${connectingWalletLabel || preferredInjectedWalletOption?.label || 'Wallet'}...`
      : initializingBurner
        ? 'Unlocking...'
        : undefined;
  const chatWalletPrimaryButtonLabel = resolveWalletPrimaryButtonLabel({
    busyLabel: chatWalletBusyLabel,
    connectLabel: chatWalletPrimaryConnectLabel,
    onCotiNetwork,
    walletAddress
  });
  const chatWalletPrimaryMetaLabel =
    walletAddress && onCotiNetwork && lastCopiedKey === chatWalletAddressCopyKey ? 'Copied' : undefined;
  const chatWalletPrimaryButtonClass = resolveWalletPrimaryButtonClassName({
    copied: lastCopiedKey === chatWalletAddressCopyKey,
    onCotiNetwork,
    walletAddress
  });
  const chatWalletPrimaryDisabled =
    connectingMethod !== null ||
    initializingBurner ||
    (!walletAddress && chatPrimaryConnectsBrowserWallet && !chatPreferredBrowserWalletOption) ||
    (!walletAddress && !chatPrimaryConnectsBrowserWallet && burnerStorageBlocked);
  const chatWalletReadiness = resolveWalletReadiness({
    chainId,
    hasAesReady,
    walletAddress
  });
  const chatWarmBrowserWalletLabel = browserWalletSession?.walletLabel ?? chatPreferredBrowserWalletOption?.label ?? 'Browser wallet';
  const chatDisplayBrowserWalletLabel =
    activeSignerSource === 'metamask'
      ? currentInjectedWalletOption?.label ?? chatWarmBrowserWalletLabel
      : chatWarmBrowserWalletLabel;
  const chatWalletDisplayModeLabel = resolveWalletModeLabel({
    appWithBrowserLabel: chatWarmBrowserWalletLabel,
    browserWalletLabel: chatDisplayBrowserWalletLabel,
    connectedWithAppWallet: chatWalletIsAppWallet,
    hasAppWalletAvailable: Boolean(appWallet),
    hasBrowserWalletAvailable: Boolean(browserWalletSession),
    walletAddress
  });
  const showChangeBurnerPinButton = hasSavedBurnerWallet && chatWalletIsAppWallet && burnerRecordReady;
  const showBackupBurnerButton = chatWalletIsAppWallet && Boolean(burnerMnemonicBackup);
  const showChatDisconnectedBrowserAction =
    Boolean(!walletAddress && !burnerStorageBlocked && chatPreferredBrowserWalletOption);
  const showChatBrowserSwitchAction =
    Boolean(walletAddress && onCotiNetwork && chatWalletIsAppWallet && chatPreferredBrowserWalletOption);
  const showChatAppSwitchAction =
    Boolean(walletAddress && onCotiNetwork && activeSignerSource === 'metamask' && !burnerStorageBlocked && hasSavedBurnerWallet);
  const showChatAppCreateAction =
    Boolean(walletAddress && onCotiNetwork && activeSignerSource === 'metamask' && !burnerStorageBlocked && !hasSavedBurnerWallet);
  const showChatAppWalletSwitchButton =
    chatWalletIsAppWallet && walletAddress && onCotiNetwork && burnerWallets.length > 1 && !burnerStorageBlocked;
  const quickChatBrowserWalletId =
    (showChatBrowserSwitchAction || showChatDisconnectedBrowserAction) && chatPreferredBrowserWalletOption
      ? chatPreferredBrowserWalletOption.id
      : '';
  const chatMenuBrowserWalletOptions = useMemo(
    () =>
      quickChatBrowserWalletId
        ? orderedChatInjectedWalletOptions.filter((option) => option.id !== quickChatBrowserWalletId)
        : orderedChatInjectedWalletOptions,
    [orderedChatInjectedWalletOptions, quickChatBrowserWalletId]
  );
  const showChatBrowserWalletMenuSection =
    chatMenuBrowserWalletOptions.length > 0 || (orderedChatInjectedWalletOptions.length === 0 && !quickChatBrowserWalletId);

  const chatAppWalletSwitchButton = showChatAppWalletSwitchButton ? (
    <AppWalletSwitchButton
      menuOpen={chatAppWalletMenuOpen}
      onToggleMenu={() => {
        setChatWalletMenuOpen(false);
        setChatAppWalletMenuOpen((previous) => !previous);
      }}
      onSelectWallet={(option) => {
        setChatAppWalletMenuOpen(false);
        Promise.resolve(handleSwitchActiveBurnerWallet(option.address || option.walletId || option.id)).catch(() => {});
      }}
      options={burnerWallets.map((walletRecord, index) => {
        const walletId = walletRecord.id ?? '';
        const walletRecordAddress = walletRecord.address?.trim() ?? '';
        const switchValue = walletRecordAddress || walletId;
        const isSelected = walletRecordAddress.toLowerCase() === walletAddress.trim().toLowerCase();
        const displayName = getBurnerWalletDisplayName(walletRecord);
        return {
          active: isSelected,
          disabled: initializingBurner || !switchValue || isSelected,
          address: walletRecordAddress,
          id: switchValue,
          key: walletRecord.id ?? `${walletRecord.privateKey}-${index}`,
          label: isSelected ? `${displayName} active` : displayName,
          walletId
        };
      })}
      disabled={initializingBurner}
    />
  ) : null;

  const unlockChatPrivacy = useCallback(async () => {
    const provider = getConnectedProvider();
    if (!walletAddress || !provider) {
      setError('Connect a browser wallet first.');
      return;
    }

    setError('');
    try {
      await activateBrowserWalletSession(
        currentInjectedWalletOption?.id ?? chatPreferredBrowserWalletOption?.id,
        { preparePrivacy: true }
      );
    } catch (privacyError) {
      setError(getProviderErrorMessage(privacyError, 'Privacy unlock was not completed.'));
    }
  }, [
    activateBrowserWalletSession,
    chatPreferredBrowserWalletOption?.id,
    currentInjectedWalletOption?.id,
    getConnectedProvider,
    setError,
    walletAddress
  ]);

  const chatPrivacyActionLabel = resolveWalletPrivacyActionLabel(connectingMethod === 'metamask');
  const showChatPrivacyStatusAction = isConnected && activeSignerSource === 'metamask' && onCotiNetwork && !hasAesReady;
  const chatWalletSwitchAction =
    (showChatBrowserSwitchAction || showChatDisconnectedBrowserAction) && chatPreferredBrowserWalletOption ? (
      <button
        type="button"
        className="p2p-wallet-aes-action wallet-switch-action"
        onClick={() => {
          activateBrowserWalletSession(chatPreferredBrowserWalletOption.id).catch(() => {});
        }}
        disabled={connectingMethod !== null || initializingBurner}
        title={`Use ${chatPreferredBrowserWalletOption.label} for this app`}
      >
        {chatPreferredBrowserWalletOption.label}
      </button>
    ) : showChatAppSwitchAction ? (
      <button
        type="button"
        className="p2p-wallet-aes-action wallet-switch-action"
        onClick={() => {
          beginBurnerPinFlow('stored').catch(() => {});
        }}
        disabled={connectingMethod !== null || initializingBurner}
        title="Use the app wallet for this app"
      >
        App wallet
      </button>
    ) : showChatAppCreateAction ? (
      <button
        type="button"
        className="p2p-wallet-aes-action wallet-switch-action"
        onClick={() => {
          beginBurnerPinFlow('generate').catch(() => {});
        }}
        disabled={connectingMethod !== null || initializingBurner}
        title="Create an app wallet so you can switch between wallet types"
      >
        Add app wallet
      </button>
    ) : null;

  const handleChatWalletPrimaryAction = () => {
    if (walletAddress && !onCotiNetwork) {
      const provider = getConnectedProvider();
      if (provider) {
        ensureCotiNetwork(provider).catch((providerError) => {
          setError(getProviderErrorMessage(providerError, 'Failed to switch network.'));
        });
      }
      return;
    }

    if (walletAddress) {
      copyWithFeedback(walletAddress, chatWalletAddressCopyKey).catch(() => {});
      return;
    }

    if (chatPrimaryConnectsBrowserWallet) {
      if (chatPreferredBrowserWalletOption) {
        activateBrowserWalletSession(chatPreferredBrowserWalletOption.id).catch(() => {});
      }
      return;
    }

    if (!burnerStorageBlocked) {
      beginBurnerPinFlow(hasSavedBurnerWallet ? 'stored' : 'generate').catch(() => {});
    }
  };

  const chatWalletHeaderControl = (
    <WalletHeaderPanel
      primaryButtonClassName={chatWalletPrimaryButtonClass}
      primaryButtonLabel={chatWalletPrimaryButtonLabel}
      primaryAddon={chatAppWalletSwitchButton}
      primaryMetaLabel={chatWalletPrimaryMetaLabel}
      primaryButtonTitle={walletAddress ? `Copy wallet address (${walletAddress})` : undefined}
      primaryDisabled={chatWalletPrimaryDisabled}
      onPrimaryAction={handleChatWalletPrimaryAction}
      modeLabel={chatWalletDisplayModeLabel}
      statusLabel={chatWalletReadiness.statusLabel}
      statusTone={chatWalletReadiness.statusTone}
      statusActionDisabled={connectingMethod !== null}
      statusActionLabel={showChatPrivacyStatusAction ? chatPrivacyActionLabel : undefined}
      statusActionTitle="Run COTI onboarding once so encrypted chat and private balances can work."
      onStatusAction={
        showChatPrivacyStatusAction
          ? () => {
              unlockChatPrivacy().catch(() => {});
            }
          : undefined
      }
      action={chatWalletSwitchAction ? <>{chatWalletSwitchAction}</> : null}
      menuOpen={chatWalletMenuOpen}
      onToggleMenu={() => {
        setChatAppWalletMenuOpen(false);
        setChatWalletMenuOpen((previous) => !previous);
      }}
      menuDisabled={connectingMethod !== null || initializingBurner}
      menu={
        <>
          <div className="p2p-wallet-menu-section">
            <span>App wallet</span>
            <button
              type="button"
              className={chatWalletIsAppWallet ? 'p2p-wallet-action active' : 'p2p-wallet-action'}
              onClick={() => {
                setChatWalletMenuOpen(false);
                beginBurnerPinFlow('stored').catch(() => {});
              }}
              disabled={initializingBurner || burnerStorageBlocked || !hasSavedBurnerWallet}
              role="menuitem"
            >
              {hasSavedBurnerWallet ? 'Connect app wallet' : 'No saved app wallet'}
            </button>
            <button
              type="button"
              className="p2p-wallet-action"
              onClick={() => {
                setChatWalletMenuOpen(false);
                beginBurnerPinFlow('generate').catch(() => {});
              }}
              disabled={initializingBurner || burnerStorageBlocked}
              role="menuitem"
            >
              Generate wallet
            </button>
            <button
              type="button"
              className="p2p-wallet-action"
              onClick={() => {
                setChatWalletMenuOpen(false);
                setShowBurnerImportModal(true);
              }}
              disabled={initializingBurner || burnerStorageBlocked}
              role="menuitem"
            >
              Import wallet
            </button>
            {showChangeBurnerPinButton ? (
              <button
                type="button"
                className="p2p-wallet-action"
                onClick={() => {
                  setChatWalletMenuOpen(false);
                  openChangeBurnerPin();
                }}
                disabled={initializingBurner}
                role="menuitem"
              >
                Change PIN
              </button>
            ) : null}
            {chatWalletIsAppWallet ? (
              <button
                type="button"
                className="p2p-wallet-action"
                onClick={() => {
                  setChatWalletMenuOpen(false);
                  setShowTopUpModal(true);
                }}
                disabled={initializingBurner || !burnerAddress}
                role="menuitem"
                title={topUpAmountWei !== null ? `Top up ${topUpAmountLabel}` : 'Top up app wallet'}
              >
                {loadingTopUpQuote ? 'Top up loading...' : `Top up ${topUpAmountLabel}`}
              </button>
            ) : null}
            {showBackupBurnerButton ? (
              <button
                type="button"
                className="p2p-wallet-action"
                onClick={() => {
                  setChatWalletMenuOpen(false);
                  beginRevealBurnerBackup();
                }}
                disabled={initializingBurner}
                role="menuitem"
              >
                Backup wallet
              </button>
            ) : null}
          </div>

          {showChatBrowserWalletMenuSection ? (
            <div className="p2p-wallet-menu-section">
              <span>Browser wallet</span>
              {chatMenuBrowserWalletOptions.length > 0 ? (
                chatMenuBrowserWalletOptions.map((option) => {
                  const isCurrentWallet =
                    activeSignerSource === 'metamask' &&
                    connectionMethod === 'metamask' &&
                    currentInjectedWalletOption?.id === option.id &&
                    isConnected;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={isCurrentWallet ? 'p2p-wallet-action active' : 'p2p-wallet-action'}
                      onClick={() => {
                        setChatWalletMenuOpen(false);
                        activateBrowserWalletSession(option.id).catch(() => {});
                      }}
                      disabled={connectingMethod !== null}
                      role="menuitem"
                    >
                      {connectingMethod === 'metamask' && connectingWalletLabel === option.label
                        ? 'Connecting...'
                        : isCurrentWallet
                          ? hasAesReady
                            ? `${option.label} ready`
                            : `Sign ${option.label}`
                          : `Connect ${option.label}`}
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

          <button
            type="button"
            className="p2p-wallet-action danger"
            onClick={() => {
              setChatWalletMenuOpen(false);
              disconnectWallet().catch(() => {});
            }}
            disabled={connectingMethod !== null || !walletAddress}
            role="menuitem"
          >
            Disconnect
          </button>
        </>
      }
    />
  );

  return {
    chatPreferredBrowserWalletOption,
    chatWalletHeaderControl,
    chatWarmAppWallet: appWallet
  };
}
