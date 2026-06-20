import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import {
  COTI_NETWORK,
  shortenAddress,
  type BurnerWalletStorageState,
  type BurnerWalletRecord,
  type Eip1193Provider,
  type SignerSource
} from './appShared/core';
import type { WalletAesHealthState } from './cotiAesUnlock';
import type { WalletReadAccount } from './walletAccountScope';

export type SharedWalletSession = {
  actions?: WalletSessionActions;
  activeSignerSource: SignerSource;
  activeBurnerWalletId?: string;
  browserProvider: Eip1193Provider | null;
  browserWalletId: string;
  browserWalletLabel: string;
  burnerWallet: Wallet | null;
  burnerWallets?: BurnerWalletRecord[];
  chainId: number | null;
  onSwitchActiveBurnerWallet?: (walletId: string) => Promise<void> | void;
  onWalletAesHealthChange?: (walletAddress: string, health: WalletAesHealthState) => void;
  sessionOnboardInfo: Record<string, OnboardInfo>;
  walletAesHealthByAddress?: Record<string, WalletAesHealthState>;
  walletAddress: string;
  walletReadAccounts?: WalletReadAccount[];
};

export type WalletBrowserConnectOptions = {
  forceAccountPicker?: boolean;
  forceFreshPrivacy?: boolean;
  preparePrivacy?: boolean;
};

export type WalletSessionSignerOptions = {
  refreshAes?: boolean;
};

export type WalletSessionActions = {
  connectAppWallet: (walletId?: string) => Promise<void> | void;
  connectBrowserWallet: (walletId?: string, options?: WalletBrowserConnectOptions) => Promise<unknown>;
  disconnect: () => Promise<void> | void;
  generateAppWallet: () => Promise<void> | void;
  getSigner: (requireAes: boolean, options?: WalletSessionSignerOptions) => Promise<JsonRpcSigner | Wallet>;
  importAppWallet: () => Promise<void> | void;
  linkAppWalletRecovery?: () => Promise<void> | void;
  recoverLinkedAppWallet?: () => Promise<void> | void;
  runWalletTransactionFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  switchAppWallet: (walletIdOrAddress: string) => Promise<void> | void;
  unlockPrivacy: (options?: { forceFreshPrivacy?: boolean }) => Promise<unknown>;
};

export type TradingBrowserWalletState = {
  browserProvider: Eip1193Provider | null;
  chainId: number | null;
  connectedWalletLabel: string;
  selectedWalletId: string;
  usesSharedBrowserWallet: boolean;
  walletAddress: string;
};

export const resolveTradingBrowserWalletState = ({
  localBrowserProvider,
  localChainId,
  localConnectedWalletLabel,
  localSelectedWalletId,
  localWalletAddress,
  sharedWalletSession
}: {
  localBrowserProvider: Eip1193Provider | null;
  localChainId: number | null;
  localConnectedWalletLabel: string;
  localSelectedWalletId: string;
  localWalletAddress: string;
  sharedWalletSession?: SharedWalletSession;
}): TradingBrowserWalletState => {
  const sharedAddress = sharedWalletSession?.walletAddress.trim() ?? '';
  const usesSharedBrowserWallet = Boolean(
    sharedWalletSession?.actions && sharedWalletSession.activeSignerSource === 'metamask'
  );

  if (!usesSharedBrowserWallet) {
    return {
      browserProvider: localBrowserProvider,
      chainId: localChainId,
      connectedWalletLabel: localConnectedWalletLabel,
      selectedWalletId: localSelectedWalletId,
      usesSharedBrowserWallet,
      walletAddress: localWalletAddress
    };
  }

  return {
    browserProvider: sharedWalletSession?.browserProvider ?? null,
    chainId: sharedWalletSession?.chainId ?? null,
    connectedWalletLabel: sharedWalletSession?.browserWalletLabel || 'Browser wallet',
    selectedWalletId: sharedWalletSession?.browserWalletId ?? localSelectedWalletId,
    usesSharedBrowserWallet,
    walletAddress: sharedAddress
  };
};

export type WalletStatusTone = 'ready' | 'warning' | 'locked' | 'muted';

export type WalletReadiness = {
  hasAesReady: boolean;
  isConnected: boolean;
  isOnCotiNetwork: boolean;
  statusLabel: string;
  statusTone: WalletStatusTone;
};

export type PrivacyUnlockSnapStatus =
  | 'unknown'
  | 'unsupported'
  | 'unsupported-mobile'
  | 'not-installed'
  | 'installed'
  | 'installed-aes-ready'
  | 'installed-aes-missing'
  | 'installed-aes-stale'
  | 'key-mismatch'
  | 'repair-needed'
  | 'rejected'
  | 'error';

export type WalletPrivacyUnlockPrompt = {
  label: string;
  title: string;
};

export type WalletPrivacyDisplayStatus =
  | 'disconnected'
  | 'wrong-network'
  | 'locked'
  | 'unlocking'
  | 'repairing'
  | 'ready'
  | 'ready-unverified'
  | 'setup-needed'
  | 'refresh-needed'
  | 'key-mismatch';

export type WalletPrivacyDisplayState = {
  actionLabel?: string;
  actionTitle?: string;
  showAction: boolean;
  status: WalletPrivacyDisplayStatus;
  statusLabel: string;
  statusTone: WalletStatusTone;
};

export type WalletHeaderPolicy = 'app-first' | 'browser-first';

export type WalletHeaderWalletKind = 'none' | 'app' | 'browser';

export type WalletHeaderPrivacyActionKind =
  | 'none'
  | 'unlock-browser-aes'
  | 'repair-browser-aes'
  | 'retry-app-aes'
  | 'setup-private-tokens'
  | 'repair-private-tokens';

export type WalletHeaderViewModel = {
  effectiveSnapStatus: PrivacyUnlockSnapStatus;
  policy: WalletHeaderPolicy;
  privacyActionKind: WalletHeaderPrivacyActionKind;
  privacyDisplay: WalletPrivacyDisplayState;
  showPrivacyAction: boolean;
  walletKind: WalletHeaderWalletKind;
};

type WalletOptionLike = {
  id: string;
};

export type WalletHeaderActionVisibility<TWalletOption extends WalletOptionLike> = {
  menuBrowserWalletOptions: TWalletOption[];
  quickBrowserWalletId: string;
  showAppCreateAction: boolean;
  showAppSwitchAction: boolean;
  showAppWalletSwitchButton: boolean;
  showBrowserQuickAction: boolean;
  showBrowserSwitchAction: boolean;
  showBrowserWalletMenuSection: boolean;
  showDisconnectedBrowserAction: boolean;
};

export type WalletConnectionPrimaryActionKind =
  | 'none'
  | 'copy-address'
  | 'switch-network'
  | 'connect-browser-wallet'
  | 'open-browser-wallet-app'
  | 'connect-app-wallet'
  | 'generate-app-wallet'
  | 'wallet-unavailable';

export type WalletConnectionPrimaryActionModel = {
  browserWalletId?: string;
  disabled: boolean;
  kind: WalletConnectionPrimaryActionKind;
  label: string;
};

export type AppWalletSwitchOptionModel = {
  active: boolean;
  address: string;
  disabled: boolean;
  id: string;
  key: string;
  label: string;
  walletId: string;
};

export type AppWalletStorageKind =
  | 'none'
  | 'legacy'
  | 'legacy-vault'
  | 'encrypted'
  | 'owner-aes';

export type AppWalletSetupStorageKind =
  | 'none'
  | 'owner-aes-current-owner'
  | 'owner-aes-other-owner'
  | 'pin-encrypted'
  | 'legacy'
  | 'legacy-vault';

export type AppWalletMenuActionVisibility = {
  showBackupWallet: boolean;
  showChangePin: boolean;
  showGenerateAccount: boolean;
  showImportAccount: boolean;
  showLinkExistingPinAccount: boolean;
  showOwnerDirectFallback: boolean;
  showPinOnlyFallback: boolean;
  showRecoverWallet: boolean;
  showSaveRecovery: boolean;
};

export type OwnerAccountFlowState =
  | 'connect-owner'
  | 'unlock-owner-aes'
  | 'checking-recovery'
  | 'account-active'
  | 'setup-needed'
  | 'recovery-error';

export type OwnerAccountFlowModel = {
  primaryLabel: string;
  state: OwnerAccountFlowState;
  statusLabel: string;
  statusTone: WalletStatusTone;
};

export type WalletOnboardingProgressStepState = 'pending' | 'active' | 'complete';

export type WalletOnboardingProgressStep = {
  label: string;
  state: WalletOnboardingProgressStepState;
};

export type WalletOnboardingProgressModel = {
  active: boolean;
  detail: string;
  steps: WalletOnboardingProgressStep[];
  title: string;
};

export type OwnerAccountFlowInput = {
  connectedWithAppWallet: boolean;
  hasAesReady: boolean;
  hasOwnerLinkedSavedAccount?: boolean;
  initializingAccount: boolean;
  ownerRecoveryError?: string;
  ownerWalletConnected: boolean;
  preferredOwnerWalletLabel?: string;
  recoveryChecking: boolean;
};

export type WalletOnboardingProgressInput = {
  appWalletAddress: string;
  connectedWithAppWallet: boolean;
  connectingOwner: boolean;
  initializingAccount: boolean;
  ownerAesReady: boolean;
  ownerWalletConnected: boolean;
  recoveryChecking: boolean;
  recoveringAccount: boolean;
  walletAesReady: boolean;
};

export type OwnerLocalAccountAutoConnectInput = {
  attemptNonce?: number;
  chainId: number | null;
  initializing: boolean;
  ownerAddress: string;
  ownerAesKey: string;
  ownerWalletConnected?: boolean;
  storageState: BurnerWalletStorageState;
};

export type OwnerRecoveryAutoConnectInput = {
  attemptNonce?: number;
  chainId: number | null;
  currentAttemptKey?: string;
  hasAesReady: boolean;
  initializing: boolean;
  ownerAddress: string;
  ownerAesKey: string;
  ownerWalletConnected?: boolean;
  recoveryConfigured: boolean;
  registryAddress: string;
};

export const WALLET_STATUS_LABEL = {
  disconnected: 'Disconnected',
  wrongNetwork: 'Wrong network',
  privacyLocked: 'Privacy locked',
  ready: 'Ready'
} as const;

export const WALLET_ACTION_LABEL = {
  connect: 'Connect wallet',
  switchNetwork: 'Switch to COTI',
  unlockPrivacy: 'Unlock privacy'
} as const;

export const normalizeWalletKey = (walletAddress: string): string => walletAddress.trim().toLowerCase();

export const hasSessionAesKey = (
  walletAddress: string,
  sessionOnboardInfo: Record<string, OnboardInfo>
): boolean => {
  const walletKey = normalizeWalletKey(walletAddress);
  return Boolean(walletKey && sessionOnboardInfo[walletKey]?.aesKey);
};

export type OwnerRecoveryWalletState = {
  ownerAesKey: string;
  ownerAesReady: boolean;
  ownerWalletAddress: string;
};

export const resolveOwnerRecoveryWalletState = ({
  activeSignerSource,
  browserWalletAddress = '',
  sessionOnboardInfo,
  walletAddress,
  walletAesHealthByAddress = {}
}: {
  activeSignerSource: SignerSource;
  browserWalletAddress?: string;
  sessionOnboardInfo: Record<string, OnboardInfo>;
  walletAddress: string;
  walletAesHealthByAddress?: Record<string, WalletAesHealthState>;
}): OwnerRecoveryWalletState => {
  const ownerWalletAddress = browserWalletAddress.trim() || (activeSignerSource === 'metamask' ? walletAddress : '');
  const ownerKey = normalizeWalletKey(ownerWalletAddress);
  const sessionAesKey = sessionOnboardInfo[ownerKey]?.aesKey;
  const ownerAesKey = typeof sessionAesKey === 'string' ? sessionAesKey.trim() : '';
  return {
    ownerAesKey,
    ownerAesReady: Boolean(ownerKey && ownerAesKey && walletAesHealthByAddress[ownerKey]?.status !== 'key-mismatch'),
    ownerWalletAddress
  };
};

export const isSessionOnCotiNetwork = (chainId: number | null): boolean => chainId === COTI_NETWORK.chainIdDecimal;

export const resolveWalletReadiness = ({
  chainId,
  hasAesReady,
  walletAddress
}: {
  chainId: number | null;
  hasAesReady: boolean;
  walletAddress: string;
}): WalletReadiness => {
  const isConnected = normalizeWalletKey(walletAddress).length > 0;
  const isOnCotiNetwork = isSessionOnCotiNetwork(chainId);

  if (!isConnected) {
    return {
      hasAesReady: false,
      isConnected,
      isOnCotiNetwork,
      statusLabel: WALLET_STATUS_LABEL.disconnected,
      statusTone: 'muted'
    };
  }

  if (!isOnCotiNetwork) {
    return {
      hasAesReady: false,
      isConnected,
      isOnCotiNetwork,
      statusLabel: WALLET_STATUS_LABEL.wrongNetwork,
      statusTone: 'warning'
    };
  }

  if (!hasAesReady) {
    return {
      hasAesReady,
      isConnected,
      isOnCotiNetwork,
      statusLabel: WALLET_STATUS_LABEL.privacyLocked,
      statusTone: 'locked'
    };
  }

  return {
    hasAesReady,
    isConnected,
    isOnCotiNetwork,
    statusLabel: WALLET_STATUS_LABEL.ready,
    statusTone: 'ready'
  };
};

export const resolveWalletStatusTone = (statusLabel: string): WalletStatusTone => {
  const normalized = statusLabel.toLowerCase();
  if (normalized.includes('ready')) {
    return 'ready';
  }
  if (normalized.includes('network') || normalized.includes('switch')) {
    return 'warning';
  }
  if (normalized.includes('locked') || normalized.includes('privacy')) {
    return 'locked';
  }
  return 'muted';
};

export const resolveWalletModeLabel = ({
  appWithBrowserLabel,
  browserWalletLabel,
  connectedWithAppWallet,
  hasAppWalletAvailable,
  hasBrowserWalletAvailable,
  noWalletLabel = 'No wallet connected',
  walletAddress
}: {
  appWithBrowserLabel?: string;
  browserWalletLabel?: string;
  connectedWithAppWallet: boolean;
  hasAppWalletAvailable?: boolean;
  hasBrowserWalletAvailable?: boolean;
  noWalletLabel?: string;
  walletAddress: string;
}): string => {
  if (!normalizeWalletKey(walletAddress)) {
    return noWalletLabel;
  }

  const browserLabel = browserWalletLabel?.trim() || 'Browser wallet';
  if (connectedWithAppWallet) {
    return hasBrowserWalletAvailable
      ? `ChainWhisper account + ${(appWithBrowserLabel?.trim() || browserLabel)}`
      : 'ChainWhisper account';
  }

  return hasAppWalletAvailable ? `${browserLabel} + ChainWhisper account` : browserLabel;
};

export const resolveWalletPrimaryButtonLabel = ({
  busyLabel,
  connectLabel,
  switchNetworkLabel = WALLET_ACTION_LABEL.switchNetwork,
  walletAddress,
  onCotiNetwork
}: {
  busyLabel?: string;
  connectLabel: string;
  onCotiNetwork: boolean;
  switchNetworkLabel?: string;
  walletAddress: string;
}): string => {
  if (busyLabel?.trim()) {
    return busyLabel;
  }
  if (normalizeWalletKey(walletAddress) && !onCotiNetwork) {
    return switchNetworkLabel;
  }
  if (normalizeWalletKey(walletAddress)) {
    return shortenAddress(walletAddress);
  }
  return connectLabel;
};

export const resolveWalletConnectionPrimaryAction = ({
  busyLabel,
  hasAppWalletStorage = true,
  hasSavedAppWallet,
  isMobileBrowser = false,
  onCotiNetwork,
  policy,
  preferredBrowserWalletId,
  preferredBrowserWalletLabel,
  walletAddress
}: {
  busyLabel?: string;
  hasAppWalletStorage?: boolean;
  hasSavedAppWallet: boolean;
  isMobileBrowser?: boolean;
  onCotiNetwork: boolean;
  policy: WalletHeaderPolicy;
  preferredBrowserWalletId?: string;
  preferredBrowserWalletLabel?: string;
  walletAddress: string;
}): WalletConnectionPrimaryActionModel => {
  const trimmedBusyLabel = busyLabel?.trim();
  const normalizedWallet = normalizeWalletKey(walletAddress);
  if (trimmedBusyLabel) {
    return {
      disabled: true,
      kind: 'none',
      label: trimmedBusyLabel
    };
  }

  if (normalizedWallet && !onCotiNetwork) {
    return {
      disabled: false,
      kind: 'switch-network',
      label: WALLET_ACTION_LABEL.switchNetwork
    };
  }

  if (normalizedWallet) {
    return {
      disabled: false,
      kind: 'copy-address',
      label: shortenAddress(walletAddress)
    };
  }

  const browserLabel = preferredBrowserWalletLabel?.trim() || 'Browser wallet';
  if (policy === 'browser-first') {
    if (preferredBrowserWalletId) {
      return {
        browserWalletId: preferredBrowserWalletId,
        disabled: false,
        kind: 'connect-browser-wallet',
        label: `Connect ${browserLabel}`
      };
    }

    if (isMobileBrowser) {
      return {
        disabled: false,
        kind: 'open-browser-wallet-app',
        label: 'Open MetaMask'
      };
    }

    return {
      disabled: true,
      kind: 'wallet-unavailable',
      label: hasSavedAppWallet && hasAppWalletStorage ? 'Browser wallet unavailable' : 'Wallet unavailable'
    };
  }

  if (hasAppWalletStorage) {
    return {
      disabled: false,
      kind: hasSavedAppWallet ? 'connect-app-wallet' : 'generate-app-wallet',
      label: hasSavedAppWallet ? 'Connect ChainWhisper account' : 'Set up ChainWhisper account'
    };
  }

  if (preferredBrowserWalletId) {
    return {
      browserWalletId: preferredBrowserWalletId,
      disabled: false,
      kind: 'connect-browser-wallet',
      label: `Connect ${browserLabel}`
    };
  }

  if (isMobileBrowser) {
    return {
      disabled: false,
      kind: 'open-browser-wallet-app',
      label: 'Open MetaMask'
    };
  }

  return {
    disabled: true,
    kind: 'wallet-unavailable',
    label: 'Wallet unavailable'
  };
};

export const resolveWalletPrimaryButtonClassName = ({
  copied,
  extraClassName = 'p2p-wallet-address',
  onCotiNetwork,
  walletAddress
}: {
  copied?: boolean;
  extraClassName?: string;
  onCotiNetwork: boolean;
  walletAddress: string;
}): string => {
  const classes = [
    !normalizeWalletKey(walletAddress) || !onCotiNetwork
      ? 'connect-btn wallet-inline-btn wallet-primary-action'
      : 'connect-btn wallet-inline-btn',
    extraClassName,
    copied ? 'copied' : ''
  ];
  return classes.filter(Boolean).join(' ');
};

export const resolveWalletPrivacyActionLabel = (unlocking: boolean): string =>
  unlocking ? 'Unlocking...' : WALLET_ACTION_LABEL.unlockPrivacy;

export const resolveWalletPrivacyUnlockPrompt = ({
  connectedWithAppWallet = false,
  hasAesReady,
  snapStatus = 'unknown',
  unlocking
}: {
  connectedWithAppWallet?: boolean;
  hasAesReady: boolean;
  snapStatus?: PrivacyUnlockSnapStatus;
  unlocking: boolean;
}): WalletPrivacyUnlockPrompt => {
  if (unlocking) {
    return {
      label: 'Unlocking...',
      title: 'Check MetaMask to unlock owner privacy.'
    };
  }

  if (hasAesReady) {
    return {
      label: WALLET_ACTION_LABEL.unlockPrivacy,
      title: 'Privacy is already unlocked for this wallet.'
    };
  }

  if (connectedWithAppWallet) {
    return {
      label: WALLET_ACTION_LABEL.unlockPrivacy,
      title: 'Unlock privacy with the connected ChainWhisper account.'
    };
  }

  switch (snapStatus) {
    case 'installed':
      return {
        label: WALLET_ACTION_LABEL.unlockPrivacy,
        title: 'Unlock owner privacy for account recovery.'
      };
    case 'installed-aes-ready':
      return {
        label: WALLET_ACTION_LABEL.unlockPrivacy,
        title: 'Unlock owner privacy for account recovery.'
      };
    case 'installed-aes-missing':
      return {
        label: WALLET_ACTION_LABEL.unlockPrivacy,
        title: 'Onboard this owner wallet in COTI Snap, then try again.'
      };
    case 'installed-aes-stale':
    case 'key-mismatch':
    case 'repair-needed':
      return {
        label: 'Unlock privacy',
        title: 'Unlock owner privacy again.'
      };
    case 'rejected':
      return {
        label: WALLET_ACTION_LABEL.unlockPrivacy,
        title: 'The COTI Snap request was rejected. Click again when you are ready to approve it.'
      };
    case 'not-installed':
      return {
        label: 'Unlock privacy',
        title: 'Install and connect COTI Snap in MetaMask desktop to recover a ChainWhisper account.'
      };
    case 'unsupported-mobile':
      return {
        label: 'Use desktop',
        title: 'MetaMask Mobile does not support COTI Snap here. Use MetaMask desktop for owner-linked recovery.'
      };
    case 'unsupported':
      return {
        label: 'Use MetaMask',
        title: 'This wallet provider cannot use COTI Snap. Use MetaMask desktop for owner-linked recovery.'
      };
    case 'error':
      return {
        label: 'Unlock privacy',
        title: 'Owner privacy could not be checked. Try again and approve the MetaMask prompts.'
      };
    case 'unknown':
    default:
      return {
        label: WALLET_ACTION_LABEL.unlockPrivacy,
        title: 'Unlock owner privacy for ChainWhisper account recovery.'
      };
  }
};

export const resolveWalletPrivacyDisplayState = ({
  chainId,
  connectedWithAppWallet = false,
  hasAesReady,
  privateTokenPrivacyAction = 'none',
  snapStatus = 'unknown',
  unlocking,
  walletAesHealth,
  walletAddress
}: {
  chainId: number | null;
  connectedWithAppWallet?: boolean;
  hasAesReady: boolean;
  privateTokenPrivacyAction?: 'none' | 'setup' | 'repair';
  snapStatus?: PrivacyUnlockSnapStatus;
  unlocking: boolean;
  walletAesHealth?: WalletAesHealthState | null;
  walletAddress: string;
}): WalletPrivacyDisplayState => {
  const isConnected = normalizeWalletKey(walletAddress).length > 0;
  if (!isConnected) {
    return {
      showAction: false,
      status: 'disconnected',
      statusLabel: WALLET_STATUS_LABEL.disconnected,
      statusTone: 'muted'
    };
  }

  if (!isSessionOnCotiNetwork(chainId)) {
    return {
      showAction: false,
      status: 'wrong-network',
      statusLabel: WALLET_STATUS_LABEL.wrongNetwork,
      statusTone: 'warning'
    };
  }

  const prompt = resolveWalletPrivacyUnlockPrompt({
    connectedWithAppWallet,
    hasAesReady:
      hasAesReady &&
      walletAesHealth?.status !== 'key-mismatch' &&
      walletAesHealth?.status !== 'repair-needed' &&
      snapStatus !== 'key-mismatch' &&
      snapStatus !== 'repair-needed' &&
      snapStatus !== 'installed-aes-stale',
    snapStatus,
    unlocking
  });

  if (unlocking) {
    return {
      actionLabel: prompt.label,
      actionTitle: prompt.title,
      showAction: true,
      status: 'unlocking',
      statusLabel: 'Unlocking privacy',
      statusTone: 'warning'
    };
  }

  if (walletAesHealth?.status === 'repairing') {
    return {
      showAction: false,
      status: 'repairing',
      statusLabel: 'Repairing privacy key',
      statusTone: 'warning'
    };
  }

  if (walletAesHealth?.status === 'key-mismatch' || snapStatus === 'key-mismatch') {
    return {
      actionLabel: prompt.label,
      actionTitle: prompt.title,
      showAction: true,
      status: 'key-mismatch',
      statusLabel: 'Privacy key mismatch',
      statusTone: 'warning'
    };
  }

  if (
    walletAesHealth?.status === 'repair-needed' ||
    snapStatus === 'repair-needed' ||
    snapStatus === 'installed-aes-stale'
  ) {
    return {
      actionLabel: prompt.label,
      actionTitle: prompt.title,
      showAction: true,
      status: 'refresh-needed',
      statusLabel: 'Privacy refresh needed',
      statusTone: 'warning'
    };
  }

  if (hasAesReady && privateTokenPrivacyAction === 'setup') {
    return {
      actionLabel: 'Set up tokens',
      actionTitle: 'Set up latest PrivateERC20 balance visibility for this wallet.',
      showAction: true,
      status: 'ready',
      statusLabel: WALLET_STATUS_LABEL.ready,
      statusTone: 'ready'
    };
  }

  if (hasAesReady && privateTokenPrivacyAction === 'repair') {
    return {
      actionLabel: 'Refresh privacy',
      actionTitle: 'Refresh latest PrivateERC20 balance visibility for this wallet.',
      showAction: true,
      status: 'ready',
      statusLabel: WALLET_STATUS_LABEL.ready,
      statusTone: 'ready'
    };
  }

  if (!hasAesReady) {
    return {
      actionLabel: prompt.label,
      actionTitle: prompt.title,
      showAction: true,
      status: 'locked',
      statusLabel: WALLET_STATUS_LABEL.privacyLocked,
      statusTone: 'locked'
    };
  }

  if (walletAesHealth?.status === 'ready-unverified') {
    return {
      showAction: false,
      status: 'ready-unverified',
      statusLabel: WALLET_STATUS_LABEL.ready,
      statusTone: 'ready'
    };
  }

  return {
    showAction: false,
    status: 'ready',
    statusLabel: WALLET_STATUS_LABEL.ready,
    statusTone: 'ready'
  };
};

export const resolveWalletHeaderViewModel = ({
  chainId,
  hasAesReady,
  policy,
  privateTokenPrivacyAction = 'none',
  snapStatus = 'unknown',
  unlocking,
  walletAesHealth,
  walletAddress,
  walletKind
}: {
  chainId: number | null;
  hasAesReady: boolean;
  policy: WalletHeaderPolicy;
  privateTokenPrivacyAction?: 'none' | 'setup' | 'repair';
  snapStatus?: PrivacyUnlockSnapStatus;
  unlocking: boolean;
  walletAesHealth?: WalletAesHealthState | null;
  walletAddress: string;
  walletKind: WalletHeaderWalletKind;
}): WalletHeaderViewModel => {
  const effectiveWalletKind = normalizeWalletKey(walletAddress) ? walletKind : 'none';
  const connectedWithAppWallet = effectiveWalletKind === 'app';
  const effectiveSnapStatus = connectedWithAppWallet ? 'unknown' : snapStatus;
  const privacyDisplay = resolveWalletPrivacyDisplayState({
    chainId,
    connectedWithAppWallet,
    hasAesReady,
    privateTokenPrivacyAction,
    snapStatus: effectiveSnapStatus,
    unlocking,
    walletAesHealth,
    walletAddress
  });

  let privacyActionKind: WalletHeaderPrivacyActionKind = 'none';
  if (normalizeWalletKey(walletAddress) && isSessionOnCotiNetwork(chainId)) {
    const aesRepairNeeded =
      walletAesHealth?.status === 'repair-needed' ||
      walletAesHealth?.status === 'key-mismatch' ||
      effectiveSnapStatus === 'repair-needed' ||
      effectiveSnapStatus === 'key-mismatch' ||
      effectiveSnapStatus === 'installed-aes-stale';
    if (hasAesReady && !aesRepairNeeded && privateTokenPrivacyAction === 'setup') {
      privacyActionKind = 'setup-private-tokens';
    } else if (hasAesReady && !aesRepairNeeded && privateTokenPrivacyAction === 'repair') {
      privacyActionKind = 'repair-private-tokens';
    } else if (effectiveWalletKind === 'browser') {
      if (privacyDisplay.status === 'locked') {
        privacyActionKind = 'unlock-browser-aes';
      } else if (privacyDisplay.status === 'key-mismatch' || privacyDisplay.status === 'refresh-needed') {
        privacyActionKind = 'repair-browser-aes';
      }
    } else if (effectiveWalletKind === 'app' && privacyDisplay.status === 'locked') {
      privacyActionKind = 'retry-app-aes';
    }
  }

  const showPrivacyAction =
    privacyActionKind === 'unlock-browser-aes' ||
    privacyActionKind === 'repair-browser-aes';

  return {
    effectiveSnapStatus,
    policy,
    privacyActionKind,
    privacyDisplay,
    showPrivacyAction,
    walletKind: effectiveWalletKind
  };
};

export const resolveWalletBlockedActionLabel = ({
  connectLabel = WALLET_ACTION_LABEL.connect,
  hasAesReady,
  onCotiNetwork,
  unlockPrivacyLabel = WALLET_ACTION_LABEL.unlockPrivacy,
  walletAddress
}: {
  connectLabel?: string;
  hasAesReady: boolean;
  onCotiNetwork: boolean;
  unlockPrivacyLabel?: string;
  walletAddress: string;
}): string | null => {
  if (!normalizeWalletKey(walletAddress)) {
    return connectLabel;
  }
  if (!onCotiNetwork) {
    return WALLET_ACTION_LABEL.switchNetwork;
  }
  if (!hasAesReady) {
    return unlockPrivacyLabel;
  }
  return null;
};

export const resolveWalletHeaderActionVisibility = <TWalletOption extends WalletOptionLike>({
  appWalletCount,
  browserWalletOptions,
  connectedWithAppWallet,
  hasSavedAppWallet,
  isConnected,
  isOnCotiNetwork,
  preferredBrowserWalletId,
  showDisconnectedBrowserAction
}: {
  appWalletCount: number;
  browserWalletOptions: TWalletOption[];
  connectedWithAppWallet: boolean;
  hasSavedAppWallet: boolean;
  isConnected: boolean;
  isOnCotiNetwork: boolean;
  preferredBrowserWalletId?: string;
  showDisconnectedBrowserAction: boolean;
}): WalletHeaderActionVisibility<TWalletOption> => {
  const quickBrowserWalletId =
    ((isConnected && isOnCotiNetwork && connectedWithAppWallet) ||
      (!isConnected && showDisconnectedBrowserAction)) &&
    preferredBrowserWalletId
      ? preferredBrowserWalletId
      : '';
  const menuBrowserWalletOptions = quickBrowserWalletId
    ? browserWalletOptions.filter((option) => option.id !== quickBrowserWalletId)
    : browserWalletOptions;

  return {
    menuBrowserWalletOptions,
    quickBrowserWalletId,
    showAppCreateAction: Boolean(isConnected && isOnCotiNetwork && !connectedWithAppWallet && !hasSavedAppWallet),
    showAppSwitchAction: Boolean(isConnected && isOnCotiNetwork && !connectedWithAppWallet && hasSavedAppWallet),
    showAppWalletSwitchButton: Boolean(
      appWalletCount > 1 &&
      (
        (isConnected && isOnCotiNetwork && connectedWithAppWallet) ||
        (!isConnected && hasSavedAppWallet)
      )
    ),
    showBrowserQuickAction: Boolean(quickBrowserWalletId),
    showBrowserSwitchAction: Boolean(isConnected && isOnCotiNetwork && connectedWithAppWallet && preferredBrowserWalletId),
    showBrowserWalletMenuSection:
      menuBrowserWalletOptions.length > 0 || (browserWalletOptions.length === 0 && !quickBrowserWalletId),
    showDisconnectedBrowserAction: Boolean(!isConnected && showDisconnectedBrowserAction && preferredBrowserWalletId)
  };
};

export const resolveAppWalletSwitchOptions = ({
  activeWalletAddress,
  disabled = false,
  getDisplayName,
  wallets
}: {
  activeWalletAddress: string;
  disabled?: boolean;
  getDisplayName?: (walletRecord: BurnerWalletRecord, index: number) => string;
  wallets: BurnerWalletRecord[];
}): AppWalletSwitchOptionModel[] => {
  const activeWalletKey = normalizeWalletKey(activeWalletAddress);
  return wallets.map((walletRecord, index) => {
    const walletId = walletRecord.id ?? '';
    const walletRecordAddress = walletRecord.address?.trim() ?? '';
    const switchValue = walletRecordAddress || walletId;
    const isSelected = Boolean(walletRecordAddress && normalizeWalletKey(walletRecordAddress) === activeWalletKey);
    const displayName =
      getDisplayName?.(walletRecord, index) ||
      walletRecord.name?.trim() ||
      (walletRecordAddress ? shortenAddress(walletRecordAddress) : `Wallet ${index + 1}`);

    const labelParts = [displayName];
    if (walletRecord.recoveryDefault) {
      labelParts.push('default');
    }
    if (isSelected) {
      labelParts.push('active');
    }

    return {
      active: isSelected,
      disabled: Boolean(disabled || !switchValue || isSelected),
      address: walletRecordAddress,
      id: switchValue,
      key: walletRecord.id ?? `${walletRecord.privateKey}-${index}`,
      label: labelParts.join(' '),
      walletId
    };
  });
};

export const resolveAppWalletSetupStorageKind = ({
  ownerAddress,
  storageKind,
  storageOwnerAddress
}: {
  ownerAddress: string;
  storageKind: AppWalletStorageKind;
  storageOwnerAddress?: string;
}): AppWalletSetupStorageKind => {
  if (storageKind === 'owner-aes') {
    const ownerKey = normalizeWalletKey(ownerAddress);
    const storageOwnerKey = normalizeWalletKey(storageOwnerAddress ?? '');
    return ownerKey && storageOwnerKey === ownerKey
      ? 'owner-aes-current-owner'
      : 'owner-aes-other-owner';
  }
  if (storageKind === 'encrypted') {
    return 'pin-encrypted';
  }
  if (storageKind === 'legacy' || storageKind === 'legacy-vault') {
    return storageKind;
  }
  return 'none';
};

export const resolveOwnerLocalAccountAutoConnectAttemptKey = ({
  attemptNonce = 0,
  chainId,
  initializing,
  ownerAddress,
  ownerAesKey,
  ownerWalletConnected = true,
  storageState
}: OwnerLocalAccountAutoConnectInput): string => {
  const ownerKey = normalizeWalletKey(ownerAddress);
  const aesKey = ownerAesKey.trim();
  if (
    !ownerWalletConnected ||
    chainId !== COTI_NETWORK.chainIdDecimal ||
    initializing ||
    !ownerKey ||
    !aesKey ||
    storageState.kind !== 'owner-aes' ||
    normalizeWalletKey(storageState.record.ownerAddress) !== ownerKey
  ) {
    return '';
  }

  return [
    ownerKey,
    storageState.record.version,
    storageState.record.iv,
    storageState.record.ciphertext.length,
    Math.max(0, Math.floor(attemptNonce))
  ].join(':');
};

export const resolveOwnerAccountFlowModel = ({
  connectedWithAppWallet,
  hasAesReady,
  hasOwnerLinkedSavedAccount = false,
  initializingAccount,
  ownerRecoveryError = '',
  ownerWalletConnected,
  preferredOwnerWalletLabel,
  recoveryChecking
}: OwnerAccountFlowInput): OwnerAccountFlowModel => {
  if (connectedWithAppWallet) {
    return {
      primaryLabel: 'ChainWhisper account ready',
      state: 'account-active',
      statusLabel: 'ChainWhisper account ready',
      statusTone: 'ready'
    };
  }

  if (ownerRecoveryError.trim()) {
    return {
      primaryLabel: 'Recover account',
      state: 'recovery-error',
      statusLabel: 'Recovery needs attention',
      statusTone: 'warning'
    };
  }

  if (recoveryChecking || initializingAccount) {
    return {
      primaryLabel: 'Checking saved account...',
      state: 'checking-recovery',
      statusLabel: 'Checking saved account',
      statusTone: 'muted'
    };
  }

  if (!ownerWalletConnected) {
    return {
      primaryLabel: `Connect ${preferredOwnerWalletLabel || 'owner wallet'}`,
      state: 'connect-owner',
      statusLabel: 'Owner wallet needed',
      statusTone: 'muted'
    };
  }

  if (!hasAesReady) {
    return {
      primaryLabel: 'Unlock privacy',
      state: 'unlock-owner-aes',
      statusLabel: 'Unlock privacy',
      statusTone: 'locked'
    };
  }

  if (hasOwnerLinkedSavedAccount) {
    return {
      primaryLabel: 'Account ready',
      state: 'setup-needed',
      statusLabel: 'Account saved locally',
      statusTone: 'warning'
    };
  }

  return {
    primaryLabel: 'Set up ChainWhisper account',
    state: 'setup-needed',
    statusLabel: 'Account needed',
    statusTone: 'warning'
  };
};

export const resolveWalletOnboardingProgressModel = ({
  appWalletAddress,
  connectedWithAppWallet,
  connectingOwner,
  initializingAccount,
  ownerAesReady,
  ownerWalletConnected,
  recoveryChecking,
  recoveringAccount,
  walletAesReady
}: WalletOnboardingProgressInput): WalletOnboardingProgressModel => {
  const accountKnown = connectedWithAppWallet || Boolean(appWalletAddress.trim());
  const findingAccount = recoveryChecking || recoveringAccount;
  const preparingAccount = initializingAccount || (connectedWithAppWallet && !walletAesReady);
  const active = connectingOwner || findingAccount || preparingAccount;
  const includeOwnerStep = ownerWalletConnected || connectingOwner;

  const steps: WalletOnboardingProgressStep[] = [];
  if (includeOwnerStep) {
    steps.push({
      label: 'Owner privacy',
      state: ownerAesReady ? 'complete' : connectingOwner ? 'active' : 'pending'
    });
  }
  steps.push({
    label: 'Find account',
    state: accountKnown ? 'complete' : findingAccount ? 'active' : 'pending'
  });
  steps.push({
    label: 'Prepare account',
    state: connectedWithAppWallet && walletAesReady ? 'complete' : preparingAccount ? 'active' : 'pending'
  });

  if (connectingOwner) {
    return {
      active,
      detail: 'Approve the wallet prompt to continue.',
      steps,
      title: 'Connecting owner wallet'
    };
  }

  if (findingAccount) {
    return {
      active,
      detail: 'Automatically checking for your saved ChainWhisper account.',
      steps,
      title: recoveryChecking ? 'Checking saved account' : 'Recovering account'
    };
  }

  if (preparingAccount) {
    return {
      active,
      detail: 'Preparing private chat and trading access.',
      steps,
      title: 'Preparing account'
    };
  }

  if (connectedWithAppWallet && walletAesReady) {
    return {
      active: false,
      detail: 'ChainWhisper account is ready.',
      steps,
      title: 'Account ready'
    };
  }

  return {
    active: false,
    detail: ownerWalletConnected ? 'Create, import, or recover an account.' : 'Connect the owner wallet to continue.',
    steps,
    title: 'Account setup needed'
  };
};

export const resolveOwnerRecoveryAutoConnectAttemptKey = ({
  attemptNonce = 0,
  chainId,
  currentAttemptKey = '',
  hasAesReady,
  initializing,
  ownerAddress,
  ownerAesKey,
  ownerWalletConnected = true,
  recoveryConfigured,
  registryAddress
}: OwnerRecoveryAutoConnectInput): string => {
  const ownerKey = normalizeWalletKey(ownerAddress);
  const aesKey = ownerAesKey.trim();
  const registryKey = normalizeWalletKey(registryAddress);
  if (
    !ownerWalletConnected ||
    chainId !== COTI_NETWORK.chainIdDecimal ||
    !hasAesReady ||
    initializing ||
    !ownerKey ||
    !aesKey ||
    !recoveryConfigured ||
    !registryKey
  ) {
    return '';
  }

  const attemptKey = `${ownerKey}:${chainId}:${registryKey}:${Math.max(0, Math.floor(attemptNonce))}`;
  return attemptKey === currentAttemptKey ? '' : attemptKey;
};

export const resolveAppWalletMenuActionVisibility = ({
  connectedWithAppWallet,
  hasMnemonicBackup,
  hasSavedAppWallet,
  ownerWalletConnected = false,
  ownerWalletReady = false,
  recoveryConfigured,
  recoveryChecking = false,
  recordReady,
  setupStorageKind,
  storageKind
}: {
  connectedWithAppWallet: boolean;
  hasMnemonicBackup: boolean;
  hasSavedAppWallet: boolean;
  ownerWalletConnected?: boolean;
  ownerWalletReady?: boolean;
  recoveryConfigured: boolean;
  recoveryChecking?: boolean;
  recordReady: boolean;
  setupStorageKind?: AppWalletSetupStorageKind;
  storageKind: AppWalletStorageKind;
}): AppWalletMenuActionVisibility => {
  const resolvedSetupStorageKind =
    setupStorageKind ??
    resolveAppWalletSetupStorageKind({
      ownerAddress: '',
      storageKind
    });
  const hasOwnerLinkedAccount = resolvedSetupStorageKind === 'owner-aes-current-owner';
  const hasPinBackedAccount =
    resolvedSetupStorageKind === 'pin-encrypted' ||
    resolvedSetupStorageKind === 'legacy' ||
    resolvedSetupStorageKind === 'legacy-vault';
  const needsPrimarySetup = !connectedWithAppWallet && !hasOwnerLinkedAccount && !hasPinBackedAccount;
  const canCheckOwnerRecovery = !connectedWithAppWallet && ownerWalletConnected && !hasOwnerLinkedAccount && !recoveryChecking;

  return {
    showBackupWallet: Boolean(connectedWithAppWallet && hasMnemonicBackup),
    showChangePin: Boolean(
      connectedWithAppWallet &&
      hasSavedAppWallet &&
      recordReady &&
      storageKind !== 'owner-aes'
    ),
    showGenerateAccount: Boolean(needsPrimarySetup && !recoveryChecking),
    showImportAccount: Boolean(needsPrimarySetup && !recoveryChecking),
    showLinkExistingPinAccount: Boolean(!connectedWithAppWallet && ownerWalletReady && hasPinBackedAccount && !recoveryChecking),
    showOwnerDirectFallback: Boolean(ownerWalletConnected),
    showPinOnlyFallback: Boolean(hasPinBackedAccount),
    showRecoverWallet: Boolean(canCheckOwnerRecovery),
    showSaveRecovery: Boolean(connectedWithAppWallet && recoveryConfigured)
  };
};
