import type { JsonRpcSigner, OnboardInfo } from '@coti-io/coti-ethers';
import type { Eip1193Provider, SignerSource } from './appShared/core';
import type { WalletAesHealthState } from './cotiAesUnlock';
import type { WalletReadAccount } from './walletAccountScope';
import type { PrivateLiquidityMetaMaskCapability } from './privateLiquidityActions';
import type { OwnerTradeV2MetaMaskCapability } from './ownerTradeV2Capability';
import type { OtcTradeHistoryV2Runtime } from './otcTradeHistoryV2Runtime';
import type { OtcV2ActionRuntime } from './otcV2ActionRuntime';
import type { issueCurrentDexReceiptCapability } from '../features/wallet/currentDexReceiptCapability';
import type { issueCurrentSharedDexTokenFundsCapability } from '../features/wallet/currentSharedDexTokenFundsCapability';
import type { issueCurrentDexQuoteCapability } from '../features/wallet/currentDexQuoteCapability';
import type { issueCurrentDexSubmissionCapability } from '../features/wallet/currentDexSubmissionCapability';
import type { issueCurrentDexPoolFundingCapability } from '../features/wallet/currentDexPoolFundingCapability';
import type { issueCurrentDexPoolPositionCapability } from '../features/wallet/currentDexPoolPositionCapability';
import type { issueCurrentDexLimitCapability } from '../features/wallet/currentDexLimitCapability';
import type { CurrentCheapDexCandidateKey } from './dexV2Deployment';
import type { CURRENT_NATIVE_POOL_PROFILE } from './currentDexNativePoolPolicy';

export type WalletBrowserConnectOptions = {
  forceAccountPicker?: boolean;
  forceFreshPrivacy?: boolean;
  preparePrivacy?: boolean;
};

export type WalletSessionSignerOptions = {
  refreshAes?: boolean;
};

export type WalletSessionDexOptions = WalletSessionSignerOptions & {
  candidate?: CurrentCheapDexCandidateKey;
  selectedPair?: readonly [string, string];
  nativePoolProfile?: typeof CURRENT_NATIVE_POOL_PROFILE;
};

export type WalletSessionActions = {
  getCurrentSharedDexTokenFundsCapability?: (expectedChainId?: bigint, options?: Pick<WalletSessionDexOptions, 'candidate'>) => ReturnType<typeof issueCurrentSharedDexTokenFundsCapability>;
  getCurrentDexPoolPositionCapability?: (expectedChainId?: bigint, options?: WalletSessionDexOptions) => ReturnType<typeof issueCurrentDexPoolPositionCapability>;
  getCurrentDexLimitCapability?: (expectedChainId?: bigint, options?: WalletSessionDexOptions) => ReturnType<typeof issueCurrentDexLimitCapability>;
  getCurrentDexPoolFundingCapability?: (
    expectedChainId?: bigint,
    options?: WalletSessionDexOptions
  ) => ReturnType<typeof issueCurrentDexPoolFundingCapability>;
  getCurrentDexQuoteCapability?: (
    expectedChainId?: bigint,
    options?: WalletSessionSignerOptions
  ) => ReturnType<typeof issueCurrentDexQuoteCapability>;
  getCurrentDexReceiptCapability?: (
    expectedChainId?: bigint,
    options?: WalletSessionSignerOptions
  ) => ReturnType<typeof issueCurrentDexReceiptCapability>;
  getCurrentDexSubmissionCapability?: (
    expectedChainId?: bigint,
    options?: Pick<WalletSessionDexOptions, 'candidate' | 'nativePoolProfile'>
  ) => ReturnType<typeof issueCurrentDexSubmissionCapability>;
  connectBrowserWallet: (walletId?: string, options?: WalletBrowserConnectOptions) => Promise<unknown>;
  disconnect: () => Promise<void> | void;
  getOwnerSigner?: (requireAes: boolean) => Promise<JsonRpcSigner>;
  getPrivateLiquidityCapability?: (
    requirePrivacy: boolean,
    expectedChainId?: bigint,
    options?: WalletSessionSignerOptions
  ) => Promise<PrivateLiquidityMetaMaskCapability>;
  getOtcV2Capability?: (
    requirePrivacy: boolean,
    expectedChainId?: bigint
  ) => Promise<OwnerTradeV2MetaMaskCapability>;
  getSigner: (requireAes: boolean, options?: WalletSessionSignerOptions) => Promise<JsonRpcSigner>;
  runWalletTransactionFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  unlockPrivacy: (options?: { forceFreshPrivacy?: boolean }) => Promise<unknown>;
};

export type SharedWalletSession = {
  actions?: WalletSessionActions;
  activeSignerSource: SignerSource;
  browserProvider: Eip1193Provider | null;
  browserWalletId: string;
  browserWalletLabel: string;
  chainId: number | null;
  onWalletAesHealthChange?: (walletAddress: string, health: WalletAesHealthState) => void;
  otcV2Runtime?: OtcTradeHistoryV2Runtime | null;
  otcV2ActionRuntime?: OtcV2ActionRuntime | null;
  otcV2RuntimeError?: string;
  sessionOnboardInfo: Record<string, OnboardInfo>;
  walletAesHealthByAddress?: Record<string, WalletAesHealthState>;
  walletAddress: string;
  walletReadAccounts?: WalletReadAccount[];
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
  const usesSharedBrowserWallet = Boolean(sharedWalletSession?.actions);
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
    walletAddress: sharedWalletSession?.walletAddress.trim() ?? ''
  };
};

export type WalletStatusTone = 'ready' | 'warning' | 'locked' | 'muted';

export const normalizeWalletKey = (walletAddress: string): string => walletAddress.trim().toLowerCase();

export const hasSessionAesKey = (
  walletAddress: string,
  sessionOnboardInfo: Record<string, OnboardInfo>
): boolean => {
  const walletKey = normalizeWalletKey(walletAddress);
  return Boolean(walletKey && sessionOnboardInfo[walletKey]?.aesKey);
};

export const resolveBrowserWalletPrivacyState = ({
  browserWalletAddress = '',
  sessionOnboardInfo,
  walletAesHealthByAddress = {}
}: {
  browserWalletAddress?: string;
  sessionOnboardInfo: Record<string, OnboardInfo>;
  walletAesHealthByAddress?: Record<string, WalletAesHealthState>;
}) => {
  const ownerWalletAddress = browserWalletAddress.trim();
  const ownerKey = normalizeWalletKey(ownerWalletAddress);
  const sessionAesKey = sessionOnboardInfo[ownerKey]?.aesKey;
  const ownerAesKey = typeof sessionAesKey === 'string' ? sessionAesKey.trim() : '';
  return {
    ownerAesKey,
    ownerAesReady: Boolean(ownerKey && ownerAesKey && walletAesHealthByAddress[ownerKey]?.status !== 'key-mismatch'),
    ownerWalletAddress
  };
};

export const resolveWalletStatusTone = (statusLabel: string): WalletStatusTone => {
  const normalized = statusLabel.toLowerCase();
  if (normalized.includes('ready')) return 'ready';
  if (normalized.includes('network') || normalized.includes('switch')) return 'warning';
  if (normalized.includes('locked') || normalized.includes('privacy')) return 'locked';
  return 'muted';
};

export const resolveWalletBlockedActionLabel = ({
  connectLabel = 'Connect wallet',
  hasAesReady,
  onCotiNetwork,
  unlockPrivacyLabel = 'Unlock privacy',
  walletAddress
}: {
  connectLabel?: string;
  hasAesReady: boolean;
  onCotiNetwork: boolean;
  unlockPrivacyLabel?: string;
  walletAddress: string;
}): string | null => {
  if (!normalizeWalletKey(walletAddress)) return connectLabel;
  if (!onCotiNetwork) return 'Switch to COTI';
  if (!hasAesReady) return unlockPrivacyLabel;
  return null;
};
