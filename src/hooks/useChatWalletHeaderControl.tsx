import { useCallback, useMemo, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { Wallet } from '@coti-io/coti-ethers';
import type { AccountFundsDirection } from '../components/AccountFundsModal';
import AppWalletSwitchButton from '../components/AppWalletSwitchButton';
import WalletHeaderPanel from '../components/WalletHeaderPanel';
import {
  getProviderErrorMessage,
  parseBurnerWalletStorageState,
  shortenAddress,
  type BurnerInitMode,
  type BurnerWalletRecord,
  type Eip1193Provider,
  type InjectedWalletOption,
  type SignerSource
} from '../lib/appShared';
import {
  buildMetaMaskMobileDeepLink,
  filterAllowedBrowserWalletOptions,
  getPreferredInjectedWalletOption,
  isMobileBrowserUserAgent,
  orderInjectedWalletOptions
} from '../lib/walletOptions';
import {
  resolveAppWalletSwitchOptions,
  resolveAppWalletMenuActionVisibility,
  resolveAppWalletSetupStorageKind,
  resolveOwnerAccountFlowModel,
  resolveWalletConnectionPrimaryAction,
  resolveWalletHeaderActionVisibility,
  resolveWalletHeaderViewModel,
  resolveWalletOnboardingProgressModel,
  resolveWalletPrimaryButtonClassName,
  type AppWalletSetupStorageKind,
  type AppWalletStorageKind
} from '../lib/walletSession';
import type { WalletAesHealthState } from '../lib/cotiAesUnlock';
import type { BrowserWalletSession } from './useWalletOnboarding';

type BrowserWalletActivationOptions = {
  forceFreshPrivacy?: boolean;
  preparePrivacy?: boolean;
};

type UseChatWalletHeaderControlArgs = {
  activeSignerSource: SignerSource;
  appWallet: Wallet | null;
  activateBrowserWalletSession: (walletId?: string, options?: BrowserWalletActivationOptions) => Promise<unknown>;
  beginLinkExistingPinWallet: () => void;
  beginBurnerPinFlow: (mode: BurnerInitMode) => Promise<unknown>;
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
  checkingOwnerRecovery: boolean;
  connectingMethod: 'metamask' | null;
  connectingWalletLabel: string;
  connectionMethod: 'metamask' | null;
  copyWithFeedback: (value: string, feedbackKey: string) => Promise<void>;
  currentInjectedWalletOption: InjectedWalletOption | null;
  deleteActiveRecoveryProfile: () => Promise<boolean> | boolean;
  disconnectWallet: () => Promise<void>;
  ensureCotiNetwork: (provider: Eip1193Provider) => Promise<void>;
  getBurnerWalletDisplayName: (walletRecord: BurnerWalletRecord) => string;
  getConnectedProvider: () => Eip1193Provider | null;
  handleSwitchActiveBurnerWallet: (walletId: string) => Promise<void> | void;
  hasAesReady: boolean;
  hasSavedBurnerWallet: boolean;
  injectedWalletOptions: InjectedWalletOption[];
  initializingBurner: boolean;
  isAppWalletRecoveryConfigured: boolean;
  isConnected: boolean;
  isMobileLayout?: boolean;
  lastCopiedKey: string | null;
  linkBurnerRecoveryWithWallet: () => Promise<void> | void;
  onCotiNetwork: boolean;
  openChangeBurnerPin: () => void;
  ownerAesReady: boolean;
  ownerRecoveryError: string;
  preferredBrowserWalletId: string;
  recoverLinkedBurnerWallet: () => Promise<void> | void;
  recoveringAppWallet: boolean;
  resetOwnerRecoveryAttempt: () => void;
  setActiveRecoveryProfileAsDefault: () => Promise<boolean> | boolean;
  setChatAppWalletMenuOpen: Dispatch<SetStateAction<boolean>>;
  setChatWalletMenuOpen: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setShowBurnerImportModal: Dispatch<SetStateAction<boolean>>;
  onOpenFundsTransfer: (direction: AccountFundsDirection) => void;
  walletAesHealth?: WalletAesHealthState | null;
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
  beginLinkExistingPinWallet,
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
  checkingOwnerRecovery,
  connectingMethod,
  connectingWalletLabel,
  connectionMethod,
  copyWithFeedback,
  currentInjectedWalletOption,
  deleteActiveRecoveryProfile,
  disconnectWallet,
  ensureCotiNetwork,
  getBurnerWalletDisplayName,
  getConnectedProvider,
  handleSwitchActiveBurnerWallet,
  hasAesReady,
  hasSavedBurnerWallet,
  injectedWalletOptions,
  initializingBurner,
  isAppWalletRecoveryConfigured,
  isConnected,
  isMobileLayout = false,
  lastCopiedKey,
  linkBurnerRecoveryWithWallet,
  onCotiNetwork,
  openChangeBurnerPin,
  ownerAesReady,
  ownerRecoveryError,
  preferredBrowserWalletId,
  recoverLinkedBurnerWallet,
  recoveringAppWallet,
  resetOwnerRecoveryAttempt,
  setActiveRecoveryProfileAsDefault,
  setChatAppWalletMenuOpen,
  setChatWalletMenuOpen,
  setError,
  setShowBurnerImportModal,
  onOpenFundsTransfer,
  walletAesHealth,
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
  const chatOwnerWalletDirectActive = isConnected && activeSignerSource === 'metamask';
  const chatOwnerWalletAddress = browserWalletSession?.address ?? (chatOwnerWalletDirectActive ? walletAddress : '');
  const chatOwnerWalletCopyKey = chatOwnerWalletAddress
    ? `owner-wallet-address:${chatOwnerWalletAddress.toLowerCase()}`
    : '';
  const isCopyKeyCopied = (copyKey: string): boolean => Boolean(copyKey && lastCopiedKey === copyKey);
  const chatOwnerWalletConnected = Boolean(chatOwnerWalletAddress);
  const appWalletStorageState = burnerStorageBlocked ? null : parseBurnerWalletStorageState();
  const appWalletSetupStorageKind: AppWalletSetupStorageKind = resolveAppWalletSetupStorageKind({
    ownerAddress: chatOwnerWalletAddress,
    storageKind: (appWalletStorageState?.kind ?? 'none') as AppWalletStorageKind,
    storageOwnerAddress:
      appWalletStorageState?.kind === 'owner-aes'
        ? appWalletStorageState.record.ownerAddress
        : undefined
  });
  const hasOwnerLinkedSavedAccount = appWalletSetupStorageKind === 'owner-aes-current-owner';
  const chatOwnerNeedsAccount = chatOwnerWalletDirectActive && onCotiNetwork && !chatWalletIsAppWallet;
  const chatOwnerNeedsPrivacy = chatOwnerNeedsAccount && !ownerAesReady;
  const chatOwnerCanUseSavedAccount =
    chatOwnerNeedsAccount && ownerAesReady && hasOwnerLinkedSavedAccount;
  const chatOwnerNeedsAccountSetup = chatOwnerNeedsAccount && !chatOwnerCanUseSavedAccount && ownerAesReady;
  const chatOwnerFirstConnect = !walletAddress;
  const chatAccountWalletAddress = burnerAddress || (chatWalletIsAppWallet ? walletAddress : '');
  const chatWalletProgress = resolveWalletOnboardingProgressModel({
    appWalletAddress: chatAccountWalletAddress,
    connectedWithAppWallet: chatWalletIsAppWallet,
    connectingOwner: connectingMethod === 'metamask',
    initializingAccount: initializingBurner,
    ownerAesReady,
    ownerWalletConnected: chatOwnerWalletConnected,
    recoveryChecking: checkingOwnerRecovery,
    recoveringAccount: recoveringAppWallet,
    walletAesReady: hasAesReady
  });
  const ownerAccountFlow = resolveOwnerAccountFlowModel({
    connectedWithAppWallet: chatWalletIsAppWallet,
    hasAesReady: ownerAesReady,
    hasOwnerLinkedSavedAccount,
    initializingAccount: initializingBurner && chatOwnerNeedsAccount,
    ownerRecoveryError,
    ownerWalletConnected: Boolean(chatOwnerWalletAddress),
    preferredOwnerWalletLabel: chatPreferredBrowserWalletOption?.label,
    recoveryChecking: checkingOwnerRecovery
  });
  const useOwnerAccountFlow =
    chatOwnerFirstConnect ||
    chatWalletIsAppWallet ||
    chatOwnerNeedsAccount ||
    Boolean(ownerRecoveryError.trim());
  const chatWalletBusyLabel =
    connectingMethod === 'metamask'
      ? 'Connecting owner...'
      : checkingOwnerRecovery
        ? 'Checking account...'
      : recoveringAppWallet
        ? 'Recovering account...'
      : initializingBurner
        ? chatWalletIsAppWallet
          ? 'Preparing account...'
          : 'Opening account...'
        : undefined;
  const chatWalletPrimaryAction = resolveWalletConnectionPrimaryAction({
    busyLabel: chatWalletBusyLabel,
    hasAppWalletStorage: !burnerStorageBlocked,
    hasSavedAppWallet: hasSavedBurnerWallet,
    isMobileBrowser: isMobileLayout || isMobileBrowserUserAgent(),
    onCotiNetwork,
    policy: 'app-first',
    preferredBrowserWalletId: chatPreferredBrowserWalletOption?.id,
    preferredBrowserWalletLabel: chatPreferredBrowserWalletOption?.label,
    walletAddress
  });
  const showMobileBrowserWalletOpenAction = Boolean(
    !walletAddress && !chatPreferredBrowserWalletOption && (isMobileLayout || isMobileBrowserUserAgent())
  );
  const chatWalletPrimaryButtonLabel = chatWalletBusyLabel
    ? chatWalletBusyLabel
    : chatWalletIsAppWallet
      ? shortenAddress(chatAccountWalletAddress || walletAddress)
    : ownerAccountFlow.state === 'recovery-error'
      ? 'Recover account'
      : chatOwnerFirstConnect
          ? 'Connect'
            : chatOwnerNeedsPrivacy
              ? 'Unlock privacy'
            : chatOwnerCanUseSavedAccount
              ? 'Open account'
              : chatOwnerNeedsAccountSetup
                ? 'Set up account'
                : chatWalletPrimaryAction.label === 'Set up ChainWhisper account'
                  ? 'Set up account'
                  : chatWalletPrimaryAction.label === 'Connect ChainWhisper account'
                    ? 'Connect account'
                    : chatWalletPrimaryAction.label;
  const chatWalletPrimaryButtonClass = chatOwnerNeedsAccount
    ? 'connect-btn wallet-inline-btn wallet-primary-action p2p-wallet-address'
    : resolveWalletPrimaryButtonClassName({
        copied: lastCopiedKey === chatWalletAddressCopyKey,
        onCotiNetwork,
        walletAddress
      });
  const chatWalletPrimaryDisabled =
    connectingMethod !== null ||
    checkingOwnerRecovery ||
    initializingBurner ||
    (!chatOwnerFirstConnect && chatWalletPrimaryAction.disabled);
  const walletNeedsPrivacyRepair =
    walletAesHealth?.status === 'repair-needed' || walletAesHealth?.status === 'key-mismatch';
  const chatWalletHeaderModel = resolveWalletHeaderViewModel({
    chainId,
    hasAesReady,
    policy: 'app-first',
    snapStatus: walletNeedsPrivacyRepair ? 'repair-needed' : 'unknown',
    unlocking: connectingMethod === 'metamask',
    walletAesHealth,
    walletAddress,
    walletKind: !walletAddress ? 'none' : chatWalletIsAppWallet ? 'app' : 'browser'
  });
  const chatWalletPrivacyDisplay = chatWalletHeaderModel.privacyDisplay;
  const chatWarmBrowserWalletLabel = browserWalletSession?.walletLabel ?? chatPreferredBrowserWalletOption?.label ?? 'Browser wallet';
  const chatWalletStatusLabel = chatWalletIsAppWallet
    ? chatWalletProgress.active
      ? chatWalletProgress.title
      : hasAesReady && ownerAesReady
      ? 'Privacy ready'
      : hasAesReady
        ? 'Account privacy ready'
        : ownerAesReady
          ? 'Owner privacy ready'
          : 'Privacy locked'
    : useOwnerAccountFlow
      ? chatOwnerFirstConnect
        ? ''
        : chatWalletProgress.active
          ? chatWalletProgress.title
        : ownerAccountFlow.state === 'unlock-owner-aes'
          ? 'Privacy locked'
          : ownerAccountFlow.state === 'setup-needed' && ownerAesReady
            ? 'Privacy ready'
            : ownerAccountFlow.statusLabel
      : chatOwnerNeedsAccount && ownerAesReady
    ? appWalletSetupStorageKind === 'owner-aes-current-owner'
      ? 'Account not active'
      : appWalletSetupStorageKind === 'pin-encrypted' ||
          appWalletSetupStorageKind === 'legacy' ||
          appWalletSetupStorageKind === 'legacy-vault'
        ? 'Link account'
      : 'Account needed'
    : chatOwnerNeedsAccount
      ? 'Unlock privacy'
      : chatWalletPrivacyDisplay.statusLabel;
  const chatWalletStatusTone = useOwnerAccountFlow
    ? chatWalletProgress.active
      ? 'muted'
      : chatOwnerFirstConnect
      ? 'muted'
      : ownerAccountFlow.state === 'unlock-owner-aes'
        ? 'locked'
        : ownerAesReady
          ? 'ready'
          : ownerAccountFlow.statusTone
    : chatOwnerNeedsAccount && ownerAesReady
    ? 'warning'
    : chatWalletPrivacyDisplay.statusTone;
  const chatWalletDisplayModeLabel: ReactNode = chatOwnerWalletAddress ? (
    <button
      type="button"
      className={
        isCopyKeyCopied(chatOwnerWalletCopyKey)
          ? 'p2p-wallet-mode-copy copied'
          : 'p2p-wallet-mode-copy'
      }
      onClick={(event) => {
        event.stopPropagation();
        copyWithFeedback(chatOwnerWalletAddress, chatOwnerWalletCopyKey).catch(() => {});
      }}
      title={
        isCopyKeyCopied(chatOwnerWalletCopyKey)
          ? 'Owner wallet address copied'
          : `Copy owner wallet address (${chatOwnerWalletAddress})`
      }
      aria-label={
        isCopyKeyCopied(chatOwnerWalletCopyKey)
          ? 'Owner wallet address copied'
          : 'Copy owner wallet address'
      }
    >
      <span className="p2p-wallet-copy-address">Owner {shortenAddress(chatOwnerWalletAddress)}</span>
      {isCopyKeyCopied(chatOwnerWalletCopyKey) ? (
        <span className="p2p-sr-only" aria-live="polite">Copied</span>
      ) : null}
    </button>
  ) : chatWalletIsAppWallet && chatAccountWalletAddress ? (
    'ChainWhisper account'
  ) : (
    ''
  );
  const appWalletMenuVisibility = resolveAppWalletMenuActionVisibility({
    connectedWithAppWallet: chatWalletIsAppWallet,
    hasMnemonicBackup: Boolean(burnerMnemonicBackup),
    hasSavedAppWallet: hasSavedBurnerWallet,
    ownerWalletConnected: Boolean(chatOwnerWalletAddress),
    ownerWalletReady: ownerAesReady && Boolean(chatOwnerWalletAddress),
    recoveryConfigured: isAppWalletRecoveryConfigured,
    recoveryChecking: checkingOwnerRecovery,
    recordReady: burnerRecordReady,
    setupStorageKind: appWalletSetupStorageKind,
    storageKind: (appWalletStorageState?.kind ?? 'none') as AppWalletStorageKind
  });
  const chatWalletActions = useMemo(
    () =>
      resolveWalletHeaderActionVisibility({
        appWalletCount: burnerStorageBlocked || (!chatWalletIsAppWallet && !hasOwnerLinkedSavedAccount) ? 0 : burnerWallets.length,
        browserWalletOptions: orderedChatInjectedWalletOptions,
        connectedWithAppWallet: chatWalletIsAppWallet,
        hasSavedAppWallet: !burnerStorageBlocked && hasOwnerLinkedSavedAccount,
        isConnected,
        isOnCotiNetwork: onCotiNetwork,
        preferredBrowserWalletId: chatPreferredBrowserWalletOption?.id,
        showDisconnectedBrowserAction: !burnerStorageBlocked
      }),
    [
      burnerStorageBlocked,
      burnerWallets.length,
      chatPreferredBrowserWalletOption?.id,
      chatWalletIsAppWallet,
      hasOwnerLinkedSavedAccount,
      isConnected,
      onCotiNetwork,
      orderedChatInjectedWalletOptions
    ]
  );
  const {
    menuBrowserWalletOptions: chatMenuBrowserWalletOptions,
    showAppWalletSwitchButton: showChatAppWalletSwitchButton,
    showBrowserWalletMenuSection: showChatBrowserWalletMenuSection
  } = chatWalletActions;

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
      options={resolveAppWalletSwitchOptions({
        activeWalletAddress: walletAddress,
        disabled: initializingBurner,
        getDisplayName: (walletRecord) => getBurnerWalletDisplayName(walletRecord),
        wallets: burnerWallets
      })}
      disabled={initializingBurner}
    />
  ) : null;

  const unlockChatPrivacy = useCallback(async () => {
    const provider = getConnectedProvider();
    if (!walletAddress || !provider) {
      setError('Connect an owner wallet first.');
      return;
    }

    setError('');
    try {
      if (walletNeedsPrivacyRepair) {
        resetOwnerRecoveryAttempt();
      }
      await activateBrowserWalletSession(
        currentInjectedWalletOption?.id ?? chatPreferredBrowserWalletOption?.id,
        { forceFreshPrivacy: walletNeedsPrivacyRepair, preparePrivacy: true }
      );
    } catch (privacyError) {
      setError(getProviderErrorMessage(privacyError, 'Owner privacy unlock was not completed.'));
    }
  }, [
    activateBrowserWalletSession,
    chatPreferredBrowserWalletOption?.id,
    currentInjectedWalletOption?.id,
    getConnectedProvider,
    resetOwnerRecoveryAttempt,
    setError,
    walletNeedsPrivacyRepair,
    walletAddress
  ]);

  const showOwnerRecoveryRetryAction = ownerAccountFlow.state === 'recovery-error';

  const handleChatWalletPrimaryAction = () => {
    if (ownerAccountFlow.state === 'recovery-error') {
      resetOwnerRecoveryAttempt();
      return;
    }

    if (chatOwnerFirstConnect) {
      if (chatPreferredBrowserWalletOption) {
        activateBrowserWalletSession(chatPreferredBrowserWalletOption.id, { preparePrivacy: true }).catch(() => {});
        return;
      }
      setChatAppWalletMenuOpen(false);
      setChatWalletMenuOpen(true);
      return;
    }

    if (chatOwnerNeedsPrivacy) {
      unlockChatPrivacy().catch(() => {});
      return;
    }

    if (chatOwnerCanUseSavedAccount) {
      beginBurnerPinFlow('stored').catch(() => {});
      return;
    }

    if (chatOwnerNeedsAccountSetup) {
      setChatAppWalletMenuOpen(false);
      setChatWalletMenuOpen(true);
      return;
    }

    switch (chatWalletPrimaryAction.kind) {
      case 'switch-network': {
        const provider = getConnectedProvider();
        if (provider) {
          ensureCotiNetwork(provider).catch((providerError) => {
            setError(getProviderErrorMessage(providerError, 'Failed to switch network.'));
          });
        }
        return;
      }
      case 'copy-address':
        copyWithFeedback(walletAddress, chatWalletAddressCopyKey).catch(() => {});
        return;
      case 'connect-browser-wallet':
        activateBrowserWalletSession(chatWalletPrimaryAction.browserWalletId, { preparePrivacy: true }).catch(() => {});
        return;
      case 'open-browser-wallet-app':
        window.location.href = buildMetaMaskMobileDeepLink();
        return;
      case 'connect-app-wallet':
        beginBurnerPinFlow('stored').catch(() => {});
        return;
      case 'generate-app-wallet':
        beginBurnerPinFlow('generate').catch(() => {});
        return;
      default:
        return;
      }
  };

  const activeRecoveryWalletRecord =
    burnerWallets.find((walletRecord) => walletRecord.address?.toLowerCase() === chatAccountWalletAddress.toLowerCase()) ??
    burnerWallets.find((walletRecord) => walletRecord.id && walletRecord.id === chatAccountWalletAddress) ??
    null;
  const activeRecoveryProfileId = activeRecoveryWalletRecord?.recoveryProfileId;
  const activeRecoveryProfileLinked =
    typeof activeRecoveryProfileId === 'number' && Number.isSafeInteger(activeRecoveryProfileId);
  const activeRecoveryProfileIsDefault = activeRecoveryWalletRecord?.recoveryDefault === true;
  const getMenuAddressButtonClassName = (copyKey: string): string =>
    isCopyKeyCopied(copyKey)
      ? 'p2p-wallet-menu-address-button copied'
      : 'p2p-wallet-menu-address-button';
  const chatOwnerStateMain: ReactNode = chatOwnerWalletAddress ? (
    <button
      type="button"
      className={getMenuAddressButtonClassName(chatOwnerWalletCopyKey)}
      onClick={() => {
        copyWithFeedback(chatOwnerWalletAddress, chatOwnerWalletCopyKey).catch(() => {});
      }}
      title={
        isCopyKeyCopied(chatOwnerWalletCopyKey)
          ? 'Owner wallet address copied'
          : `Copy owner wallet address (${chatOwnerWalletAddress})`
      }
      aria-label={
        isCopyKeyCopied(chatOwnerWalletCopyKey)
          ? 'Owner wallet address copied'
          : 'Copy owner wallet address'
      }
    >
      <span className="p2p-wallet-copy-address">{shortenAddress(chatOwnerWalletAddress)}</span>
      {isCopyKeyCopied(chatOwnerWalletCopyKey) ? (
        <span className="p2p-sr-only" aria-live="polite">Copied</span>
      ) : null}
    </button>
  ) : (
    'Not connected'
  );
  const chatOwnerStateDetail = chatOwnerWalletAddress
    ? `${chatWarmBrowserWalletLabel} - ${ownerAesReady ? 'Privacy ready' : 'Privacy locked'}`
    : '';
  const chatAccountStateMain: ReactNode = chatAccountWalletAddress ? (
    <button
      type="button"
      className={getMenuAddressButtonClassName(chatWalletAddressCopyKey)}
      onClick={() => {
        copyWithFeedback(chatAccountWalletAddress, chatWalletAddressCopyKey).catch(() => {});
      }}
      title={
        isCopyKeyCopied(chatWalletAddressCopyKey)
          ? 'ChainWhisper account address copied'
          : `Copy ChainWhisper account address (${chatAccountWalletAddress})`
      }
      aria-label={
        isCopyKeyCopied(chatWalletAddressCopyKey)
          ? 'ChainWhisper account address copied'
          : 'Copy ChainWhisper account address'
      }
    >
      <span className="p2p-wallet-copy-address">{shortenAddress(chatAccountWalletAddress)}</span>
      {isCopyKeyCopied(chatWalletAddressCopyKey) ? (
        <span className="p2p-sr-only" aria-live="polite">Copied</span>
      ) : null}
    </button>
  ) : appWalletSetupStorageKind === 'owner-aes-current-owner'
      ? 'Saved locally'
      : appWalletSetupStorageKind === 'owner-aes-other-owner'
        ? 'Saved for another owner'
        : appWalletSetupStorageKind === 'pin-encrypted' ||
            appWalletSetupStorageKind === 'legacy' ||
            appWalletSetupStorageKind === 'legacy-vault'
          ? 'PIN-only saved'
      : 'Not set up';
  const chatAccountStateDetail = chatAccountWalletAddress
    ? [
        activeRecoveryProfileIsDefault ? 'Default' : 'Active',
        hasAesReady ? 'Privacy ready' : 'Privacy locked'
      ].filter(Boolean).join(' - ')
    : '';
  const chatAccountModelHint = chatWalletIsAppWallet
    ? ''
    : ownerRecoveryError
      ? ownerRecoveryError
    : appWalletSetupStorageKind === 'pin-encrypted' ||
        appWalletSetupStorageKind === 'legacy' ||
        appWalletSetupStorageKind === 'legacy-vault'
      ? 'Link the saved PIN account once to use owner-wallet recovery.'
    : chatOwnerWalletConnected
      ? 'Create, import, or recover a ChainWhisper account to use chat and trades.'
      : 'Connect an owner wallet, then create or recover a ChainWhisper account.';
  const chatWalletHeaderControl = (
    <WalletHeaderPanel
      busy={chatWalletProgress.active}
      primaryButtonClassName={chatWalletPrimaryButtonClass}
      primaryButtonLabel={chatWalletPrimaryButtonLabel}
      primaryAddon={chatAppWalletSwitchButton}
      primaryButtonTitle={
        ownerAccountFlow.state === 'recovery-error'
          ? ownerRecoveryError || 'Retry ChainWhisper account recovery'
        : chatOwnerFirstConnect
          ? 'Connect the owner wallet used for login, funding, and recovery'
            : chatOwnerNeedsPrivacy
            ? 'Unlock owner privacy before setting up the ChainWhisper account'
            : chatOwnerCanUseSavedAccount
              ? 'Use the saved ChainWhisper account for chat and trades'
              : chatOwnerNeedsAccountSetup
                ? 'Open ChainWhisper account setup options'
                : walletAddress
                  ? isCopyKeyCopied(chatWalletAddressCopyKey)
                    ? `Active wallet address copied (${walletAddress})`
                    : `Copy active wallet address (${walletAddress})`
                  : undefined
      }
      primaryDisabled={chatWalletPrimaryDisabled}
      onPrimaryAction={handleChatWalletPrimaryAction}
      modeLabel={chatWalletDisplayModeLabel}
      statusLabel={chatWalletStatusLabel}
      statusTone={chatWalletStatusTone}
      statusActionDisabled={connectingMethod !== null || recoveringAppWallet || checkingOwnerRecovery}
      statusActionLabel={
        showOwnerRecoveryRetryAction
          ? 'Recover account'
          : undefined
      }
      statusActionTitle={
        showOwnerRecoveryRetryAction
          ? ownerRecoveryError || 'Retry ChainWhisper account recovery'
          : undefined
      }
      onStatusAction={
        showOwnerRecoveryRetryAction
          ? () => {
              resetOwnerRecoveryAttempt();
            }
          : undefined
      }
      menuOpen={chatWalletMenuOpen}
      onToggleMenu={() => {
        setChatAppWalletMenuOpen(false);
        setChatWalletMenuOpen((previous) => !previous);
      }}
      menuDisabled={connectingMethod !== null}
      menu={
        <>
          <div className="p2p-wallet-menu-section p2p-wallet-account-model">
            <span>Account</span>
            {chatWalletProgress.active ? (
              <div className="p2p-wallet-onboarding-progress" aria-live="polite">
                <div className="p2p-wallet-onboarding-progress-head">
                  <strong>{chatWalletProgress.title}</strong>
                  <small>{chatWalletProgress.detail}</small>
                </div>
                <div className="p2p-wallet-onboarding-steps">
                  {chatWalletProgress.steps.map((step) => (
                    <span
                      key={step.label}
                      className={`p2p-wallet-onboarding-step ${step.state}`}
                    >
                      <i aria-hidden="true" />
                      {step.label}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="p2p-wallet-account-card primary">
              <small>ChainWhisper account</small>
              <strong>{chatAccountStateMain}</strong>
              {chatAccountStateDetail ? <em>{chatAccountStateDetail}</em> : null}
            </div>
            <div className="p2p-wallet-account-card">
              <small>Owner wallet</small>
              <strong>{chatOwnerStateMain}</strong>
              {chatOwnerStateDetail ? <em>{chatOwnerStateDetail}</em> : null}
            </div>
            {chatWalletIsAppWallet ? (
              <button
                type="button"
                className="p2p-wallet-action primary p2p-wallet-account-funds-action"
                onClick={() => {
                  setChatWalletMenuOpen(false);
                  onOpenFundsTransfer('move');
                }}
                disabled={initializingBurner || !burnerAddress || !chatOwnerWalletAddress}
                role="menuitem"
                title="Move funds between the owner wallet and the ChainWhisper account"
              >
                Move or withdraw
              </button>
            ) : null}
            {chatAccountModelHint ? <p>{chatAccountModelHint}</p> : null}
          </div>

          <div className="p2p-wallet-menu-section p2p-wallet-menu-action-section">
            <span>Account setup</span>
            {!chatWalletIsAppWallet && appWalletSetupStorageKind === 'owner-aes-current-owner' ? (
              <button
                type="button"
                className="p2p-wallet-action primary"
                onClick={() => {
                  setChatWalletMenuOpen(false);
                  beginBurnerPinFlow('stored').catch(() => {});
                }}
                disabled={initializingBurner || burnerStorageBlocked}
                role="menuitem"
              >
                Open saved account
              </button>
            ) : null}
            {appWalletMenuVisibility.showGenerateAccount ? (
              <button
                type="button"
                className="p2p-wallet-action primary"
                onClick={() => {
                  setChatWalletMenuOpen(false);
                  beginBurnerPinFlow('generate').catch(() => {});
                }}
                disabled={initializingBurner || burnerStorageBlocked || !chatOwnerWalletAddress}
                role="menuitem"
              >
                Create account
              </button>
            ) : null}
            {appWalletMenuVisibility.showImportAccount ? (
              <button
                type="button"
                className="p2p-wallet-action"
                onClick={() => {
                  setChatWalletMenuOpen(false);
                  setShowBurnerImportModal(true);
                }}
                disabled={initializingBurner || burnerStorageBlocked || !chatOwnerWalletAddress}
                role="menuitem"
              >
                Import account
              </button>
            ) : null}
            {appWalletMenuVisibility.showRecoverWallet ? (
              <button
                type="button"
                className="p2p-wallet-action primary"
                onClick={() => {
                  setChatWalletMenuOpen(false);
                  if (ownerAesReady) {
                    resetOwnerRecoveryAttempt();
                  } else {
                    Promise.resolve(recoverLinkedBurnerWallet()).catch(() => {});
                  }
                }}
                disabled={initializingBurner || recoveringAppWallet || checkingOwnerRecovery || !chatOwnerWalletAddress}
                role="menuitem"
                title="Recover the ChainWhisper account saved for this owner wallet"
              >
                {recoveringAppWallet || checkingOwnerRecovery
                  ? 'Checking saved account...'
                  : ownerAesReady
                    ? 'Recover account'
                    : 'Unlock privacy and recover'}
              </button>
            ) : null}
            {appWalletMenuVisibility.showLinkExistingPinAccount ? (
              <button
                type="button"
                className="p2p-wallet-action"
                onClick={() => {
                  setChatWalletMenuOpen(false);
                  beginLinkExistingPinWallet();
                }}
                disabled={initializingBurner || burnerStorageBlocked || checkingOwnerRecovery}
                role="menuitem"
              >
                Link PIN account
              </button>
            ) : null}
            {appWalletMenuVisibility.showBackupWallet ? (
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
                Back up phrase
              </button>
            ) : null}
            {appWalletMenuVisibility.showChangePin ? (
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
          </div>

          <div className="p2p-wallet-menu-section p2p-wallet-menu-action-section">
            <span>Recovery</span>
            {showChatBrowserWalletMenuSection ? (
              chatMenuBrowserWalletOptions.length > 0 ? (
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
                        activateBrowserWalletSession(option.id, { preparePrivacy: true }).catch(() => {});
                      }}
                      disabled={connectingMethod !== null}
                      role="menuitem"
                    >
                      {connectingMethod === 'metamask' && connectingWalletLabel === option.label
                        ? 'Connecting owner...'
                        : isCurrentWallet
                          ? ownerAesReady
                            ? `${option.label} ready`
                            : `Unlock ${option.label} privacy`
                          : `Connect ${option.label}`}
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
              )
            ) : null}
            {appWalletMenuVisibility.showSaveRecovery && !activeRecoveryProfileLinked ? (
              <button
                type="button"
                className="p2p-wallet-action"
                onClick={() => {
                  setChatWalletMenuOpen(false);
                  Promise.resolve(linkBurnerRecoveryWithWallet()).catch(() => {});
                }}
                disabled={initializingBurner || recoveringAppWallet || !isAppWalletRecoveryConfigured || !chatOwnerWalletAddress}
                role="menuitem"
                title={
                  !chatOwnerWalletAddress
                    ? 'Connect the owner wallet before saving recovery'
                    : isAppWalletRecoveryConfigured
                    ? 'Save this ChainWhisper account recovery to your owner wallet'
                    : 'ChainWhisper account recovery is not configured yet'
                }
              >
                {recoveringAppWallet ? 'Saving...' : 'Save recovery'}
              </button>
            ) : null}
            {chatWalletIsAppWallet && activeRecoveryProfileLinked && !activeRecoveryProfileIsDefault ? (
              <button
                type="button"
                className="p2p-wallet-action primary"
                onClick={() => {
                  setChatWalletMenuOpen(false);
                  Promise.resolve(setActiveRecoveryProfileAsDefault()).catch(() => {});
                }}
                disabled={initializingBurner || recoveringAppWallet || !chatOwnerWalletAddress}
                role="menuitem"
                title="Use this recovered account automatically after owner login"
              >
                Make default
              </button>
            ) : null}
            {chatWalletIsAppWallet && activeRecoveryProfileLinked ? (
              <button
                type="button"
                className="p2p-wallet-action danger"
                onClick={() => {
                  setChatWalletMenuOpen(false);
                  Promise.resolve(deleteActiveRecoveryProfile()).catch(() => {});
                }}
                disabled={initializingBurner || recoveringAppWallet || !chatOwnerWalletAddress}
                role="menuitem"
                title="Remove this account from owner-wallet recovery"
              >
                Remove recovery
              </button>
            ) : null}
          </div>

          {appWalletMenuVisibility.showPinOnlyFallback || appWalletMenuVisibility.showOwnerDirectFallback ? (
            <div className="p2p-wallet-menu-section p2p-wallet-menu-action-section muted">
              <span>Advanced</span>
              {appWalletMenuVisibility.showPinOnlyFallback ? (
                <button
                  type="button"
                  className="p2p-wallet-action"
                  onClick={() => {
                    setChatWalletMenuOpen(false);
                    beginBurnerPinFlow('stored').catch(() => {});
                  }}
                  disabled={initializingBurner || burnerStorageBlocked}
                  role="menuitem"
                >
                  Use PIN-only account
                </button>
              ) : null}
              {appWalletMenuVisibility.showOwnerDirectFallback ? (
                <button
                  type="button"
                  className={chatOwnerWalletDirectActive ? 'p2p-wallet-action active' : 'p2p-wallet-action'}
                  onClick={() => {
                    setChatWalletMenuOpen(false);
                    activateBrowserWalletSession(
                      browserWalletSession?.walletId ?? chatPreferredBrowserWalletOption?.id,
                      { preparePrivacy: true }
                    ).catch(() => {});
                  }}
                  disabled={connectingMethod !== null}
                  role="menuitem"
                >
                  {chatOwnerWalletDirectActive ? 'Owner wallet active' : 'Use owner wallet'}
                </button>
              ) : null}
            </div>
          ) : null}

          {walletAddress ? (
            <button
              type="button"
              className="p2p-wallet-action danger p2p-wallet-disconnect-action"
              onClick={() => {
                setChatWalletMenuOpen(false);
                disconnectWallet().catch(() => {});
              }}
              disabled={connectingMethod !== null}
              role="menuitem"
            >
              Disconnect
            </button>
          ) : null}
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
