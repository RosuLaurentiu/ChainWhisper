import { useMemo, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import WalletHeaderPanel from '../components/WalletHeaderPanel';
import {
  getProviderErrorMessage,
  type InjectedWalletOption
} from '../../../lib/appShared';
import type { WalletAesHealthState } from '../../../lib/cotiAesUnlock';
import {
  buildMetaMaskMobileDeepLink,
  filterAllowedBrowserWalletOptions,
  getPreferredInjectedWalletOption,
  isMobileBrowserUserAgent,
  orderInjectedWalletOptions
} from '../../../lib/walletOptions';
import type { BrowserWalletSession } from './useWalletOnboarding';
import {
  CIPHERTRADE_WALLETCONNECT_WALLET_ID,
  isCipherTradeWalletConnectConfigured
} from '../../../lib/walletConnectMobile';
import type { ChatReadCursorCloudSyncStatus } from './useChatReadCursorCloudSync';

type BrowserWalletActivationOptions = {
  forceFreshPrivacy?: boolean;
  preparePrivacy?: boolean;
};

type UseChatWalletHeaderControlArgs = {
  activateBrowserWalletSession: (walletId?: string, options?: BrowserWalletActivationOptions) => Promise<unknown>;
  browserWalletSession: BrowserWalletSession | null;
  chatWalletMenuOpen: boolean;
  connectingMethod: 'metamask' | null;
  connectingWalletLabel: string;
  copyWithFeedback: (value: string, feedbackKey: string) => Promise<void>;
  currentInjectedWalletOption: InjectedWalletOption | null;
  disconnectWallet: () => Promise<void>;
  injectedWalletOptions: InjectedWalletOption[];
  isMobileLayout?: boolean;
  lastCopiedKey: string | null;
  ownerAesReady: boolean;
  preferredBrowserWalletId: string;
  readCursorCloudConfigured?: boolean;
  readCursorCloudStatus?: ChatReadCursorCloudSyncStatus;
  onToggleReadCursorCloud?: () => Promise<void>;
  setChatWalletMenuOpen: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  walletAesHealth?: WalletAesHealthState | null;
  walletAddress: string;
  utilityMenu?: ReactNode;
  utilityMenuBadgeCount?: number;
  utilityMenuWarning?: boolean;
};

type UseChatWalletHeaderControlResult = {
  chatPreferredBrowserWalletOption: InjectedWalletOption | null;
  chatWalletHeaderControl: ReactNode;
  unlockPrivacy: () => void;
};

const formatHeaderAddress = (address: string, compact: boolean): string =>
  compact
    ? `${address.slice(0, 4)}\u2026${address.slice(-4)}`
    : `${address.slice(0, 6)}\u2026${address.slice(-4)}`;

export default function useChatWalletHeaderControl({
  activateBrowserWalletSession,
  browserWalletSession,
  chatWalletMenuOpen,
  connectingMethod,
  connectingWalletLabel,
  copyWithFeedback,
  currentInjectedWalletOption,
  disconnectWallet,
  injectedWalletOptions,
  isMobileLayout = false,
  lastCopiedKey,
  ownerAesReady,
  preferredBrowserWalletId,
  readCursorCloudConfigured = false,
  readCursorCloudStatus = 'unavailable',
  onToggleReadCursorCloud,
  setChatWalletMenuOpen,
  setError,
  walletAesHealth,
  walletAddress,
  utilityMenu,
  utilityMenuBadgeCount = 0,
  utilityMenuWarning = false
}: UseChatWalletHeaderControlArgs): UseChatWalletHeaderControlResult {
  const allowedWallets = useMemo(
    () => filterAllowedBrowserWalletOptions(injectedWalletOptions),
    [injectedWalletOptions]
  );
  const chatPreferredBrowserWalletOption = useMemo(
    () => getPreferredInjectedWalletOption(allowedWallets, preferredBrowserWalletId, 'selected'),
    [allowedWallets, preferredBrowserWalletId]
  );
  const orderedWallets = useMemo(
    () => orderInjectedWalletOptions(
      allowedWallets,
      currentInjectedWalletOption?.id ?? preferredBrowserWalletId,
      'selected'
    ),
    [allowedWallets, currentInjectedWalletOption?.id, preferredBrowserWalletId]
  );
  const walletConnectingDesignQa = import.meta.env.DEV && typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('walletQa') === 'connecting';
  const privacyLockedDesignQa = import.meta.env.DEV && typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('privacyQa') === 'locked';
  const connected = Boolean(walletAddress) || walletConnectingDesignQa || privacyLockedDesignQa;
  const displayAddress = walletAddress || '0x5dfc00000000000000000000000000000000979d';
  const privacyUnlockingDesignQa = import.meta.env.DEV && typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('privacyQa') === 'unlocking';
  const busy = connectingMethod !== null || walletConnectingDesignQa;
  const copyKey = connected ? `wallet-address:${displayAddress.toLowerCase()}` : '';
  const copied = Boolean(copyKey && lastCopiedKey === copyKey);
  const privacyNeedsRepair =
    walletAesHealth?.status === 'repair-needed' || walletAesHealth?.status === 'key-mismatch';
  const statusLabel = privacyUnlockingDesignQa && connected
    ? 'Unlocking privacy...'
    : !connected
    ? ''
    : privacyNeedsRepair
      ? 'Privacy needs repair'
      : ownerAesReady
        ? 'Privacy ready'
        : 'Privacy locked';
  const statusTone = !connected ? 'muted' : ownerAesReady && !privacyNeedsRepair ? 'ready' : 'locked';
  const preferredLabel =
    currentInjectedWalletOption?.label ??
    browserWalletSession?.walletLabel ??
    chatPreferredBrowserWalletOption?.label ??
    'wallet';
  const connectingLabel = connectingWalletLabel || (walletConnectingDesignQa ? 'MetaMask' : preferredLabel);

  const connectWallet = (walletId?: string, forceFreshPrivacy = false): void => {
    setError('');
    void activateBrowserWalletSession(walletId, {
      forceFreshPrivacy,
      preparePrivacy: true
    }).catch((error) => {
      setError(getProviderErrorMessage(error, 'Wallet connection was not completed.'));
    });
  };
  const unlockPrivacy = (): void => {
    connectWallet(currentInjectedWalletOption?.id ?? browserWalletSession?.walletId, privacyNeedsRepair);
  };

  const showMobileOpen = !connected && orderedWallets.length === 0 &&
    (isMobileLayout || isMobileBrowserUserAgent());
  const compactWalletLabel = busy || isMobileLayout || isMobileBrowserUserAgent();
  const cipherTradeWalletConnectConfigured = isCipherTradeWalletConnectConfigured();
  const cipherTradeWalletConnectActive =
    connected && browserWalletSession?.walletId === CIPHERTRADE_WALLETCONNECT_WALLET_ID;
  const readCursorCloudBusy =
    readCursorCloudStatus === 'restoring' || readCursorCloudStatus === 'authorizing';
  const readCursorCloudReady = readCursorCloudStatus === 'ready';
  const readCursorCloudLabel = readCursorCloudBusy
    ? 'Read-status sync working...'
    : readCursorCloudReady
      ? 'Disable and delete synced read status'
      : readCursorCloudStatus === 'authorization-required'
        ? 'Resume cross-device read status'
        : 'Enable cross-device read status';
  const chatWalletHeaderControl = (
    <WalletHeaderPanel
      busy={busy}
      primaryButtonClassName={
        connected
          ? copied
            ? 'connect-btn wallet-inline-btn wallet-primary-action p2p-wallet-address copied'
            : 'connect-btn wallet-inline-btn wallet-primary-action p2p-wallet-address'
          : 'connect-btn wallet-inline-btn wallet-primary-action'
      }
      primaryButtonLabel={
        busy
          ? compactWalletLabel
            ? 'Connecting…'
            : `Connecting ${connectingWalletLabel || preferredLabel}...`
          : connected
            ? formatHeaderAddress(displayAddress, compactWalletLabel)
            : compactWalletLabel
              ? 'Connect'
              : 'Connect wallet'
      }
      primaryButtonTitle={
        busy
          ? `Connecting to ${connectingLabel}`
          : connected
          ? copied
            ? `Wallet address copied (${displayAddress})`
            : `Copy wallet address (${displayAddress})`
          : 'Connect MetaMask or CipherTrade'
      }
      primaryDisabled={busy}
      onPrimaryAction={() => {
        if (connected) {
          void copyWithFeedback(displayAddress, copyKey);
          return;
        }
        connectWallet(chatPreferredBrowserWalletOption?.id);
      }}
      modeLabel={connected ? preferredLabel : ''}
      statusLabel={statusLabel}
      statusTone={statusTone}
      statusActionLabel={connected && (!ownerAesReady || privacyNeedsRepair) ? 'Unlock privacy' : undefined}
      statusActionTitle={connected && (!ownerAesReady || privacyNeedsRepair)
        ? `Unlock privacy with ${preferredLabel}`
        : undefined}
      statusActionDisabled={busy}
      onStatusAction={connected && (!ownerAesReady || privacyNeedsRepair)
        ? unlockPrivacy
        : undefined}
      menuOpen={chatWalletMenuOpen}
      menuBadgeCount={utilityMenuBadgeCount}
      menuWarning={utilityMenuWarning}
      onToggleMenu={() => setChatWalletMenuOpen((open) => !open)}
      menuDisabled={busy}
      menu={
        connected ? <>
          {utilityMenu}
          {readCursorCloudConfigured && onToggleReadCursorCloud ? (
            <div className="p2p-wallet-menu-section p2p-wallet-menu-action-section">
              <span>Chat privacy</span>
              <button
                type="button"
                className={readCursorCloudReady ? 'p2p-wallet-action active' : 'p2p-wallet-action'}
                onClick={() => {
                  setChatWalletMenuOpen(false);
                  setError('');
                  void onToggleReadCursorCloud().catch((cause) => {
                    setError(getProviderErrorMessage(
                      cause,
                      'Cross-device read-status preference was not changed.'
                    ));
                  });
                }}
                disabled={busy || readCursorCloudBusy}
                role="menuitem"
                aria-pressed={readCursorCloudReady}
                title={readCursorCloudReady
                  ? 'Delete this wallet\'s synced read cursors and sign this device out. Messages and encryption keys were never stored.'
                  : 'Sync only finalized message IDs and block anchors. Messages and encryption keys stay out of Supabase.'}
              >
                {readCursorCloudLabel}
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="p2p-wallet-action danger p2p-wallet-disconnect-action"
            onClick={() => {
              setChatWalletMenuOpen(false);
              void disconnectWallet();
            }}
            disabled={busy}
            role="menuitem"
          >
            Disconnect
          </button>
        </> : <>
          <div className="p2p-wallet-menu-section p2p-wallet-menu-action-section">
            <span>Wallet</span>
            {orderedWallets.map((option) => {
              const active = connected && currentInjectedWalletOption?.id === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={active ? 'p2p-wallet-action active' : 'p2p-wallet-action'}
                  onClick={() => {
                    setChatWalletMenuOpen(false);
                    if (!active || !ownerAesReady || privacyNeedsRepair) {
                      connectWallet(option.id, active && privacyNeedsRepair);
                    }
                  }}
                  disabled={busy}
                  role="menuitem"
                >
                  {active
                    ? ownerAesReady && !privacyNeedsRepair
                      ? `${option.label} ready`
                      : `Unlock ${option.label} privacy`
                    : `Connect ${option.label}`}
                </button>
              );
            })}
            <button
              type="button"
              className={cipherTradeWalletConnectActive ? 'p2p-wallet-action active' : 'p2p-wallet-action'}
              onClick={() => {
                setChatWalletMenuOpen(false);
                connectWallet(CIPHERTRADE_WALLETCONNECT_WALLET_ID);
              }}
              disabled={busy || !cipherTradeWalletConnectConfigured || cipherTradeWalletConnectActive}
              title={
                cipherTradeWalletConnectConfigured
                  ? 'Scan a WalletConnect QR code with CipherTrade Mobile'
                  : 'Set VITE_WALLETCONNECT_PROJECT_ID to enable CipherTrade Mobile'
              }
              role="menuitem"
            >
              {cipherTradeWalletConnectActive
                ? 'CipherTrade Mobile ready'
                : cipherTradeWalletConnectConfigured
                  ? 'Connect CipherTrade Mobile'
                  : 'CipherTrade Mobile setup needed'}
            </button>
            {orderedWallets.length === 0 ? (
              <button
                type="button"
                className="p2p-wallet-action"
                onClick={() => {
                  if (showMobileOpen) window.location.href = buildMetaMaskMobileDeepLink();
                }}
                disabled={!showMobileOpen}
                role="menuitem"
              >
                {showMobileOpen ? 'Open MetaMask Mobile' : 'MetaMask or CipherTrade not detected'}
              </button>
            ) : null}
          </div>
        </>
      }
    />
  );

  return {
    chatPreferredBrowserWalletOption,
    chatWalletHeaderControl,
    unlockPrivacy
  };
}
