import type { OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import {
  COTI_NETWORK,
  shortenAddress,
  type BurnerWalletRecord,
  type Eip1193Provider,
  type SignerSource
} from './appShared/core';
import type { WalletAesHealthState } from './cotiAesUnlock';

export type SharedWalletSession = {
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

export type AppWalletSwitchOptionModel = {
  active: boolean;
  address: string;
  disabled: boolean;
  id: string;
  key: string;
  label: string;
  walletId: string;
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
      ? `App + ${(appWithBrowserLabel?.trim() || browserLabel)}`
      : 'App wallet';
  }

  return hasAppWalletAvailable ? `${browserLabel} + app` : browserLabel;
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
      title: 'Check your wallet prompt to finish the privacy unlock.'
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
      title: 'Unlock privacy with the connected app wallet.'
    };
  }

  switch (snapStatus) {
    case 'installed':
      return {
        label: WALLET_ACTION_LABEL.unlockPrivacy,
        title: 'Unlock with COTI Snap.'
      };
    case 'installed-aes-ready':
      return {
        label: WALLET_ACTION_LABEL.unlockPrivacy,
        title: 'Unlock with COTI Snap.'
      };
    case 'installed-aes-missing':
      return {
        label: WALLET_ACTION_LABEL.unlockPrivacy,
        title: 'COTI Snap has no AES key for this account. Make sure this account was selected during Snap install. Onboard it in the COTI Snap wallet, then unlock again.'
      };
    case 'installed-aes-stale':
    case 'key-mismatch':
    case 'repair-needed':
      return {
        label: WALLET_ACTION_LABEL.unlockPrivacy,
        title: 'Unlock privacy will refresh this wallet AES key if the Snap key does not decrypt wallet data.'
      };
    case 'rejected':
      return {
        label: WALLET_ACTION_LABEL.unlockPrivacy,
        title: 'The COTI Snap request was rejected. Click again when you are ready to approve it.'
      };
    case 'not-installed':
      return {
        label: WALLET_ACTION_LABEL.unlockPrivacy,
        title: 'COTI Snap is not installed for this wallet. Unlock privacy will use wallet AES if Snap is unavailable.'
      };
    case 'unsupported-mobile':
      return {
        label: WALLET_ACTION_LABEL.unlockPrivacy,
        title: 'MetaMask Mobile does not support Snaps here. Unlock privacy will use wallet AES.'
      };
    case 'unsupported':
      return {
        label: WALLET_ACTION_LABEL.unlockPrivacy,
        title: 'COTI Snap is unavailable for this wallet provider. Unlock privacy will use wallet AES.'
      };
    case 'error':
      return {
        label: WALLET_ACTION_LABEL.unlockPrivacy,
        title: 'COTI Snap status could not be checked. Try unlocking privacy and approve the wallet prompts.'
      };
    case 'unknown':
    default:
      return {
        label: WALLET_ACTION_LABEL.unlockPrivacy,
        title: 'Unlock privacy to reveal private balances, receipts, and encrypted trade history.'
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
    privacyActionKind === 'setup-private-tokens' ||
    privacyActionKind === 'repair-private-tokens' ||
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

    return {
      active: isSelected,
      disabled: Boolean(disabled || !switchValue || isSelected),
      address: walletRecordAddress,
      id: switchValue,
      key: walletRecord.id ?? `${walletRecord.privateKey}-${index}`,
      label: isSelected ? `${displayName} active` : displayName,
      walletId
    };
  });
};
