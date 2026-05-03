import type { OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import {
  COTI_NETWORK,
  shortenAddress,
  type BurnerWalletRecord,
  type Eip1193Provider,
  type SignerSource
} from './appShared/core';

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
  sessionOnboardInfo: Record<string, OnboardInfo>;
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
    showAppWalletSwitchButton: Boolean(isConnected && isOnCotiNetwork && connectedWithAppWallet && appWalletCount > 1),
    showBrowserQuickAction: Boolean(quickBrowserWalletId),
    showBrowserSwitchAction: Boolean(isConnected && isOnCotiNetwork && connectedWithAppWallet && preferredBrowserWalletId),
    showBrowserWalletMenuSection:
      menuBrowserWalletOptions.length > 0 || (browserWalletOptions.length === 0 && !quickBrowserWalletId),
    showDisconnectedBrowserAction: Boolean(!isConnected && showDisconnectedBrowserAction && preferredBrowserWalletId)
  };
};
