import { describe, expect, it } from 'vitest';
import type { OnboardInfo } from '@coti-io/coti-ethers';
import { COTI_NETWORK, hasInsufficientFundsError } from './appShared/core';
import {
  hasSessionAesKey,
  resolveAppWalletMenuActionVisibility,
  resolveAppWalletSetupStorageKind,
  resolveTradingBrowserWalletState,
  resolveAppWalletSwitchOptions,
  resolveOwnerAccountFlowModel,
  resolveOwnerLocalAccountAutoConnectAttemptKey,
  resolveOwnerRecoveryAutoConnectAttemptKey,
  resolveOwnerRecoveryWalletState,
  resolveWalletConnectionPrimaryAction,
  resolveWalletBlockedActionLabel,
  resolveWalletHeaderActionVisibility,
  resolveWalletHeaderViewModel,
  resolveWalletModeLabel,
  resolveWalletOnboardingProgressModel,
  resolveWalletPrimaryButtonClassName,
  resolveWalletPrimaryButtonLabel,
  resolveWalletPrivacyDisplayState,
  resolveWalletPrivacyUnlockPrompt,
  resolveWalletReadiness,
  type SharedWalletSession
} from './walletSession';

describe('resolveWalletReadiness', () => {
  it('standardizes disconnected, wrong-network, locked, and ready states', () => {
    expect(resolveWalletReadiness({ chainId: null, hasAesReady: false, walletAddress: '' })).toMatchObject({
      statusLabel: 'Disconnected',
      statusTone: 'muted'
    });
    expect(resolveWalletReadiness({ chainId: 1, hasAesReady: true, walletAddress: '0xabc' })).toMatchObject({
      statusLabel: 'Wrong network',
      statusTone: 'warning'
    });
    expect(
      resolveWalletReadiness({
        chainId: COTI_NETWORK.chainIdDecimal,
        hasAesReady: false,
        walletAddress: '0xabc'
      })
    ).toMatchObject({
      statusLabel: 'Privacy locked',
      statusTone: 'locked'
    });
    expect(
      resolveWalletReadiness({
        chainId: COTI_NETWORK.chainIdDecimal,
        hasAesReady: true,
        walletAddress: '0xabc'
      })
    ).toMatchObject({
      statusLabel: 'Ready',
      statusTone: 'ready'
    });
  });
});

describe('resolveWalletModeLabel', () => {
  it('describes ChainWhisper, browser, and warm secondary wallet modes consistently', () => {
    expect(
      resolveWalletModeLabel({
        connectedWithAppWallet: true,
        hasBrowserWalletAvailable: true,
        walletAddress: '0xabc',
        appWithBrowserLabel: 'MetaMask'
      })
    ).toBe('ChainWhisper account + MetaMask');
    expect(
      resolveWalletModeLabel({
        connectedWithAppWallet: false,
        browserWalletLabel: 'CipherTrade',
        hasAppWalletAvailable: true,
        walletAddress: '0xabc'
      })
    ).toBe('CipherTrade + ChainWhisper account');
    expect(resolveWalletModeLabel({ connectedWithAppWallet: false, walletAddress: '' })).toBe('No wallet connected');
  });
});

describe('resolveTradingBrowserWalletState', () => {
  const localProvider = { request: async () => [] };
  const sharedProvider = { request: async () => [] };
  const sharedActions = {} as NonNullable<SharedWalletSession['actions']>;

  const buildSharedSession = (
    overrides: Partial<SharedWalletSession> = {}
  ): SharedWalletSession => ({
    actions: sharedActions,
    activeSignerSource: 'metamask',
    browserProvider: sharedProvider,
    browserWalletId: 'metamask',
    browserWalletLabel: 'MetaMask',
    burnerWallet: null,
    chainId: COTI_NETWORK.chainIdDecimal,
    sessionOnboardInfo: {},
    walletAddress: '0xShared',
    ...overrides
  });

  it('uses the App-owned browser wallet state for Trading when shared actions exist', () => {
    expect(
      resolveTradingBrowserWalletState({
        localBrowserProvider: localProvider,
        localChainId: 1,
        localConnectedWalletLabel: 'Local MetaMask',
        localSelectedWalletId: 'local-metamask',
        localWalletAddress: '0xLocal',
        sharedWalletSession: buildSharedSession()
      })
    ).toMatchObject({
      browserProvider: sharedProvider,
      chainId: COTI_NETWORK.chainIdDecimal,
      connectedWalletLabel: 'MetaMask',
      selectedWalletId: 'metamask',
      usesSharedBrowserWallet: true,
      walletAddress: '0xShared'
    });
  });

  it('keeps app-wallet sessions out of the Trading browser-wallet derivation', () => {
    expect(
      resolveTradingBrowserWalletState({
        localBrowserProvider: localProvider,
        localChainId: 1,
        localConnectedWalletLabel: 'Local MetaMask',
        localSelectedWalletId: 'local-metamask',
        localWalletAddress: '0xLocal',
        sharedWalletSession: buildSharedSession({
          activeSignerSource: 'burner',
          browserProvider: null,
          walletAddress: '0xAppWallet'
        })
      })
    ).toMatchObject({
      browserProvider: localProvider,
      chainId: 1,
      connectedWalletLabel: 'Local MetaMask',
      selectedWalletId: 'local-metamask',
      usesSharedBrowserWallet: false,
      walletAddress: '0xLocal'
    });
  });

  it('does not fall back to stale local browser state when App owns a disconnected browser session', () => {
    expect(
      resolveTradingBrowserWalletState({
        localBrowserProvider: localProvider,
        localChainId: 1,
        localConnectedWalletLabel: 'Local MetaMask',
        localSelectedWalletId: 'local-metamask',
        localWalletAddress: '0xLocal',
        sharedWalletSession: buildSharedSession({
          browserProvider: null,
          chainId: null,
          walletAddress: ''
        })
      })
    ).toMatchObject({
      browserProvider: null,
      chainId: null,
      usesSharedBrowserWallet: true,
      walletAddress: ''
    });
  });
});

describe('wallet header labels', () => {
  it('resolves the primary action label and class', () => {
    expect(
      resolveWalletPrimaryButtonLabel({
        busyLabel: 'Connecting MetaMask...',
        connectLabel: 'Connect app wallet',
        onCotiNetwork: false,
        walletAddress: ''
      })
    ).toBe('Connecting MetaMask...');
    expect(
      resolveWalletPrimaryButtonLabel({
        connectLabel: 'Connect app wallet',
        onCotiNetwork: false,
        walletAddress: '0x1234567890abcdef'
      })
    ).toBe('Switch to COTI');
    expect(
      resolveWalletPrimaryButtonClassName({
        copied: true,
        onCotiNetwork: true,
        walletAddress: '0x1234567890abcdef'
      })
    ).toBe('connect-btn wallet-inline-btn p2p-wallet-address copied');
  });

  it('uses the same blocked-action labels for WISP Portal and wallet panels', () => {
    expect(resolveWalletBlockedActionLabel({ hasAesReady: false, onCotiNetwork: false, walletAddress: '' })).toBe(
      'Connect wallet'
    );
    expect(resolveWalletBlockedActionLabel({ hasAesReady: false, onCotiNetwork: false, walletAddress: '0xabc' })).toBe(
      'Switch to COTI'
    );
    expect(resolveWalletBlockedActionLabel({ hasAesReady: false, onCotiNetwork: true, walletAddress: '0xabc' })).toBe(
      'Unlock privacy'
    );
  });

  it('keeps one unlock privacy action while making the prompt source-aware', () => {
    expect(
      resolveWalletPrivacyUnlockPrompt({
        hasAesReady: false,
        snapStatus: 'installed',
        unlocking: false
      })
    ).toMatchObject({
      label: 'Unlock privacy',
      title: 'Unlock owner privacy for account recovery.'
    });
    expect(
      resolveWalletPrivacyUnlockPrompt({
        hasAesReady: false,
        snapStatus: 'installed-aes-missing',
        unlocking: false
      }).title
    ).toContain('Onboard this owner wallet');
    expect(
      resolveWalletPrivacyUnlockPrompt({
        hasAesReady: false,
        snapStatus: 'unsupported',
        unlocking: false
      }).title
    ).toContain('MetaMask desktop');
    expect(
      resolveWalletPrivacyUnlockPrompt({
        hasAesReady: false,
        snapStatus: 'unsupported-mobile',
        unlocking: false
      }).title
    ).toContain('Use MetaMask desktop');
    expect(
      resolveWalletPrivacyUnlockPrompt({
        hasAesReady: false,
        snapStatus: 'installed-aes-stale',
        unlocking: false
    })
    ).toMatchObject({
      label: 'Unlock privacy'
    });
    expect(
      resolveWalletPrivacyUnlockPrompt({
        hasAesReady: false,
        snapStatus: 'key-mismatch',
        unlocking: false
      })
    ).toMatchObject({
      label: 'Unlock privacy'
    });
    expect(
      resolveWalletPrivacyUnlockPrompt({
        hasAesReady: false,
        snapStatus: 'repair-needed',
        unlocking: false
      })
    ).toMatchObject({
      label: 'Unlock privacy'
    });
    expect(
      resolveWalletPrivacyUnlockPrompt({
        hasAesReady: false,
        snapStatus: 'rejected',
        unlocking: false
      }).title
    ).toContain('rejected');
    expect(resolveWalletPrivacyUnlockPrompt({ hasAesReady: false, unlocking: true }).label).toBe('Unlocking...');
  });
});

describe('resolveWalletConnectionPrimaryAction', () => {
  it('still supports browser-wallet fallback primary actions when explicitly requested', () => {
    expect(
      resolveWalletConnectionPrimaryAction({
        hasSavedAppWallet: true,
        onCotiNetwork: false,
        policy: 'browser-first',
        preferredBrowserWalletId: 'metamask',
        preferredBrowserWalletLabel: 'MetaMask',
        walletAddress: ''
      })
    ).toMatchObject({
      browserWalletId: 'metamask',
      disabled: false,
      kind: 'connect-browser-wallet',
      label: 'Connect MetaMask'
    });

    expect(
      resolveWalletConnectionPrimaryAction({
        hasSavedAppWallet: true,
        isMobileBrowser: true,
        onCotiNetwork: false,
        policy: 'browser-first',
        walletAddress: ''
      })
    ).toMatchObject({
      disabled: false,
      kind: 'open-browser-wallet-app',
      label: 'Open MetaMask'
    });

    expect(
      resolveWalletConnectionPrimaryAction({
        hasSavedAppWallet: true,
        onCotiNetwork: false,
        policy: 'browser-first',
        walletAddress: ''
      })
    ).toMatchObject({
      disabled: true,
      kind: 'wallet-unavailable',
      label: 'Browser wallet unavailable'
    });
  });

  it('keeps app pages app-first when no wallet is connected', () => {
    expect(
      resolveWalletConnectionPrimaryAction({
        hasSavedAppWallet: true,
        onCotiNetwork: false,
        policy: 'app-first',
        preferredBrowserWalletId: 'metamask',
        preferredBrowserWalletLabel: 'MetaMask',
        walletAddress: ''
      })
    ).toMatchObject({
      disabled: false,
      kind: 'connect-app-wallet',
      label: 'Connect ChainWhisper account'
    });

    expect(
      resolveWalletConnectionPrimaryAction({
        hasSavedAppWallet: false,
        onCotiNetwork: false,
        policy: 'app-first',
        walletAddress: ''
      })
    ).toMatchObject({
      disabled: false,
      kind: 'generate-app-wallet',
      label: 'Set up ChainWhisper account'
    });
  });

  it('uses network and copy actions for connected wallets regardless of page policy', () => {
    expect(
      resolveWalletConnectionPrimaryAction({
        hasSavedAppWallet: true,
        onCotiNetwork: false,
        policy: 'browser-first',
        walletAddress: '0x1234567890abcdef'
      })
    ).toMatchObject({
      kind: 'switch-network',
      label: 'Switch to COTI'
    });

    expect(
      resolveWalletConnectionPrimaryAction({
        hasSavedAppWallet: true,
        onCotiNetwork: true,
        policy: 'app-first',
        walletAddress: '0x1234567890abcdef'
      })
    ).toMatchObject({
      kind: 'copy-address',
      label: '0x1234...cdef'
    });
  });
});

describe('resolveWalletPrivacyDisplayState', () => {
  it('returns one display state for locked, setup, ready, refresh, and mismatch cases', () => {
    const walletAddress = '0x1234567890abcdef';
    expect(
      resolveWalletPrivacyDisplayState({
        chainId: COTI_NETWORK.chainIdDecimal,
        hasAesReady: false,
        unlocking: false,
        walletAddress
      })
    ).toMatchObject({
      showAction: true,
      status: 'locked',
      statusLabel: 'Privacy locked'
    });
    expect(
      resolveWalletPrivacyDisplayState({
        chainId: COTI_NETWORK.chainIdDecimal,
        hasAesReady: true,
        privateTokenPrivacyAction: 'setup',
        unlocking: false,
        walletAddress
      })
    ).toMatchObject({
      actionLabel: 'Set up tokens',
      showAction: true,
      status: 'ready',
      statusLabel: 'Ready'
    });
    expect(
      resolveWalletPrivacyDisplayState({
        chainId: COTI_NETWORK.chainIdDecimal,
        hasAesReady: true,
        unlocking: false,
        walletAesHealth: {
          status: 'repairing',
          updatedAt: 1,
          walletKey: walletAddress
        },
        walletAddress
      })
    ).toMatchObject({
      showAction: false,
      status: 'repairing',
      statusLabel: 'Repairing privacy key'
    });
    expect(
      resolveWalletPrivacyDisplayState({
        chainId: COTI_NETWORK.chainIdDecimal,
        hasAesReady: true,
        unlocking: false,
        walletAesHealth: {
          status: 'ready-unverified',
          updatedAt: 1,
          walletKey: walletAddress
        },
        walletAddress
      })
    ).toMatchObject({
      showAction: false,
      status: 'ready-unverified',
      statusLabel: 'Ready'
    });
    expect(
      resolveWalletPrivacyDisplayState({
        chainId: COTI_NETWORK.chainIdDecimal,
        hasAesReady: true,
        privateTokenPrivacyAction: 'repair',
        unlocking: false,
        walletAddress
      })
    ).toMatchObject({
      showAction: true,
      status: 'ready',
      statusLabel: 'Ready'
    });
    expect(
      resolveWalletPrivacyDisplayState({
        chainId: COTI_NETWORK.chainIdDecimal,
        hasAesReady: true,
        snapStatus: 'key-mismatch',
        unlocking: false,
        walletAddress
      })
    ).toMatchObject({
      showAction: true,
      status: 'key-mismatch',
      statusLabel: 'Privacy key mismatch'
    });
  });
});

describe('resolveWalletHeaderViewModel', () => {
  const walletAddress = '0x1234567890abcdef';

  it('keeps connected app wallets ready and ignores stale browser Snap status', () => {
    expect(
      resolveWalletHeaderViewModel({
        chainId: COTI_NETWORK.chainIdDecimal,
        hasAesReady: true,
        policy: 'browser-first',
        snapStatus: 'key-mismatch',
        unlocking: false,
        walletAddress,
        walletKind: 'app'
      })
    ).toMatchObject({
      effectiveSnapStatus: 'unknown',
      privacyActionKind: 'none',
      privacyDisplay: {
        status: 'ready',
        statusLabel: 'Ready'
      },
      showPrivacyAction: false,
      walletKind: 'app'
    });
  });

  it('keeps browser wallets repairable when their Snap AES state is stale', () => {
    expect(
      resolveWalletHeaderViewModel({
        chainId: COTI_NETWORK.chainIdDecimal,
        hasAesReady: true,
        policy: 'app-first',
        snapStatus: 'key-mismatch',
        unlocking: false,
        walletAddress,
        walletKind: 'browser'
      })
    ).toMatchObject({
      effectiveSnapStatus: 'key-mismatch',
      privacyActionKind: 'repair-browser-aes',
      privacyDisplay: {
        status: 'key-mismatch'
      },
      showPrivacyAction: true
    });
  });

  it('keeps private-token setup as the only app-wallet status action once AES is ready', () => {
    expect(
      resolveWalletHeaderViewModel({
        chainId: COTI_NETWORK.chainIdDecimal,
        hasAesReady: true,
        policy: 'browser-first',
        privateTokenPrivacyAction: 'setup',
        snapStatus: 'installed-aes-stale',
        unlocking: false,
        walletAddress,
        walletKind: 'app'
      })
    ).toMatchObject({
      effectiveSnapStatus: 'unknown',
      privacyActionKind: 'setup-private-tokens',
      privacyDisplay: {
        actionLabel: 'Set up tokens',
        status: 'ready',
        statusLabel: 'Ready'
      },
      showPrivacyAction: false
    });
  });

  it('keeps the AES status ready without turning the status pill into a token refresh button', () => {
    expect(
      resolveWalletHeaderViewModel({
        chainId: COTI_NETWORK.chainIdDecimal,
        hasAesReady: true,
        policy: 'browser-first',
        privateTokenPrivacyAction: 'repair',
        unlocking: false,
        walletAddress,
        walletKind: 'browser'
      })
    ).toMatchObject({
      privacyActionKind: 'repair-private-tokens',
      privacyDisplay: {
        actionLabel: 'Refresh privacy',
        status: 'ready',
        statusLabel: 'Ready'
      },
      showPrivacyAction: false
    });
  });

  it('keeps app-first and browser-fallback policies explicit in the model', () => {
    expect(
      resolveWalletHeaderViewModel({
        chainId: null,
        hasAesReady: false,
        policy: 'browser-first',
        unlocking: false,
        walletAddress: '',
        walletKind: 'none'
      })
    ).toMatchObject({
      policy: 'browser-first',
      privacyActionKind: 'none',
      walletKind: 'none'
    });

    expect(
      resolveWalletHeaderViewModel({
        chainId: null,
        hasAesReady: false,
        policy: 'app-first',
        unlocking: false,
        walletAddress: '',
        walletKind: 'none'
      })
    ).toMatchObject({
      policy: 'app-first',
      privacyActionKind: 'none',
      walletKind: 'none'
    });
  });
});

describe('resolveAppWalletMenuActionVisibility', () => {
  it('shows PIN changes only for connected non-owner-AES app wallets', () => {
    expect(
      resolveAppWalletMenuActionVisibility({
        connectedWithAppWallet: true,
        hasMnemonicBackup: false,
        hasSavedAppWallet: true,
        recoveryConfigured: true,
        recordReady: true,
        storageKind: 'encrypted'
      }).showChangePin
    ).toBe(true);

    expect(
      resolveAppWalletMenuActionVisibility({
        connectedWithAppWallet: true,
        hasMnemonicBackup: false,
        hasSavedAppWallet: true,
        recoveryConfigured: true,
        recordReady: true,
        storageKind: 'owner-aes'
      }).showChangePin
    ).toBe(false);
  });

  it('shows mnemonic backup only when the connected app wallet has a mnemonic', () => {
    expect(
      resolveAppWalletMenuActionVisibility({
        connectedWithAppWallet: true,
        hasMnemonicBackup: true,
        hasSavedAppWallet: true,
        recoveryConfigured: false,
        recordReady: true,
        storageKind: 'encrypted'
      }).showBackupWallet
    ).toBe(true);

    expect(
      resolveAppWalletMenuActionVisibility({
        connectedWithAppWallet: true,
        hasMnemonicBackup: false,
        hasSavedAppWallet: true,
        recoveryConfigured: false,
        recordReady: true,
        storageKind: 'encrypted'
      }).showBackupWallet
    ).toBe(false);
  });

  it('shows save and recover actions only when app wallet recovery is configured', () => {
    expect(
      resolveAppWalletMenuActionVisibility({
        connectedWithAppWallet: true,
        hasMnemonicBackup: false,
        hasSavedAppWallet: true,
        recoveryConfigured: true,
        recordReady: true,
        storageKind: 'owner-aes'
      })
    ).toMatchObject({
      showRecoverWallet: false,
      showSaveRecovery: true
    });

    expect(
      resolveAppWalletMenuActionVisibility({
        connectedWithAppWallet: true,
        hasMnemonicBackup: false,
        hasSavedAppWallet: true,
        recoveryConfigured: false,
        recordReady: true,
        storageKind: 'owner-aes'
      })
    ).toMatchObject({
      showRecoverWallet: false,
      showSaveRecovery: false
    });
  });

  it('surfaces setup, recovery, and linking actions from owner-first storage state', () => {
    expect(
      resolveAppWalletMenuActionVisibility({
        connectedWithAppWallet: false,
        hasMnemonicBackup: false,
        hasSavedAppWallet: false,
        ownerWalletConnected: true,
        ownerWalletReady: true,
        recoveryConfigured: true,
        recordReady: false,
        setupStorageKind: 'none',
        storageKind: 'none'
      })
    ).toMatchObject({
      showGenerateAccount: true,
      showImportAccount: true,
      showRecoverWallet: true,
      showLinkExistingPinAccount: false
    });

    expect(
      resolveAppWalletMenuActionVisibility({
        connectedWithAppWallet: false,
        hasMnemonicBackup: false,
        hasSavedAppWallet: true,
        ownerWalletConnected: true,
        ownerWalletReady: true,
        recoveryConfigured: true,
        recordReady: false,
        setupStorageKind: 'pin-encrypted',
        storageKind: 'encrypted'
      })
    ).toMatchObject({
      showGenerateAccount: false,
      showImportAccount: false,
      showLinkExistingPinAccount: true,
      showPinOnlyFallback: true
    });
  });

  it('holds primary setup actions while owner recovery is checking', () => {
    expect(
      resolveAppWalletMenuActionVisibility({
        connectedWithAppWallet: false,
        hasMnemonicBackup: false,
        hasSavedAppWallet: true,
        ownerWalletConnected: true,
        ownerWalletReady: true,
        recoveryChecking: true,
        recoveryConfigured: true,
        recordReady: false,
        setupStorageKind: 'pin-encrypted',
        storageKind: 'encrypted'
      })
    ).toMatchObject({
      showGenerateAccount: false,
      showImportAccount: false,
      showLinkExistingPinAccount: false,
      showRecoverWallet: false,
      showOwnerDirectFallback: true,
      showPinOnlyFallback: true
    });
  });
});

describe('owner-linked app wallet setup helpers', () => {
  it('keeps active app-wallet AES separate from owner recovery AES', () => {
    const ownerAddress = '0x1111111111111111111111111111111111111111';
    const appWalletAddress = '0x2222222222222222222222222222222222222222';

    expect(
      resolveOwnerRecoveryWalletState({
        activeSignerSource: 'burner',
        browserWalletAddress: ownerAddress,
        sessionOnboardInfo: {
          [appWalletAddress]: { aesKey: 'app-wallet-aes' } as OnboardInfo
        },
        walletAddress: appWalletAddress
      })
    ).toMatchObject({
      ownerWalletAddress: ownerAddress,
      ownerAesKey: '',
      ownerAesReady: false
    });
  });

  it('keeps owner AES ready while the ChainWhisper account is active', () => {
    const ownerAddress = '0x1111111111111111111111111111111111111111';
    const appWalletAddress = '0x2222222222222222222222222222222222222222';

    expect(
      resolveOwnerRecoveryWalletState({
        activeSignerSource: 'burner',
        browserWalletAddress: ownerAddress,
        sessionOnboardInfo: {
          [ownerAddress]: { aesKey: 'owner-snap-aes' } as OnboardInfo,
          [appWalletAddress]: { aesKey: 'app-wallet-aes' } as OnboardInfo
        },
        walletAddress: appWalletAddress
      })
    ).toMatchObject({
      ownerWalletAddress: ownerAddress,
      ownerAesKey: 'owner-snap-aes',
      ownerAesReady: true
    });
  });

  it('models the owner-first account flow states', () => {
    expect(
      resolveOwnerAccountFlowModel({
        connectedWithAppWallet: false,
        hasAesReady: false,
        initializingAccount: false,
        ownerWalletConnected: false,
        preferredOwnerWalletLabel: 'MetaMask',
        recoveryChecking: false
      })
    ).toMatchObject({
      primaryLabel: 'Connect MetaMask',
      state: 'connect-owner',
      statusLabel: 'Owner wallet needed'
    });

    expect(
      resolveOwnerAccountFlowModel({
        connectedWithAppWallet: false,
        hasAesReady: false,
        initializingAccount: false,
        ownerWalletConnected: true,
        recoveryChecking: false
      })
    ).toMatchObject({
      primaryLabel: 'Unlock privacy',
      state: 'unlock-owner-aes',
      statusLabel: 'Unlock privacy'
    });

    expect(
      resolveOwnerAccountFlowModel({
        connectedWithAppWallet: false,
        hasAesReady: true,
        initializingAccount: false,
        ownerWalletConnected: true,
        recoveryChecking: true
      })
    ).toMatchObject({
      primaryLabel: 'Checking saved account...',
      state: 'checking-recovery',
      statusLabel: 'Checking saved account'
    });

    expect(
      resolveOwnerAccountFlowModel({
        connectedWithAppWallet: true,
        hasAesReady: true,
        initializingAccount: false,
        ownerWalletConnected: true,
        recoveryChecking: false
      })
    ).toMatchObject({
      primaryLabel: 'ChainWhisper account ready',
      state: 'account-active',
      statusTone: 'ready'
    });

    expect(
      resolveOwnerAccountFlowModel({
        connectedWithAppWallet: false,
        hasAesReady: true,
        hasOwnerLinkedSavedAccount: true,
        initializingAccount: false,
        ownerWalletConnected: true,
        recoveryChecking: false
      })
    ).toMatchObject({
      primaryLabel: 'Account ready',
      state: 'setup-needed',
      statusLabel: 'Account saved locally'
    });

    expect(
      resolveOwnerAccountFlowModel({
        connectedWithAppWallet: false,
        hasAesReady: true,
        initializingAccount: false,
        ownerWalletConnected: true,
        recoveryChecking: false
      })
    ).toMatchObject({
      primaryLabel: 'Set up ChainWhisper account',
      state: 'setup-needed',
      statusLabel: 'Account needed'
    });

    expect(
      resolveOwnerAccountFlowModel({
        connectedWithAppWallet: false,
        hasAesReady: true,
        initializingAccount: false,
        ownerRecoveryError: 'Failed to recover ChainWhisper account.',
        ownerWalletConnected: true,
        recoveryChecking: false
      })
    ).toMatchObject({
      primaryLabel: 'Recover account',
      state: 'recovery-error',
      statusLabel: 'Recovery needs attention'
    });
  });

  it('shows onboarding progress while a saved ChainWhisper account is being recovered', () => {
    const progress = resolveWalletOnboardingProgressModel({
      appWalletAddress: '',
      connectedWithAppWallet: false,
      connectingOwner: false,
      initializingAccount: false,
      ownerAesReady: true,
      ownerWalletConnected: true,
      recoveryChecking: true,
      recoveringAccount: true,
      walletAesReady: false
    });

    expect(progress).toMatchObject({
      active: true,
      title: 'Checking saved account',
      detail: 'Automatically checking for your saved ChainWhisper account.'
    });
    expect(progress.steps).toEqual([
      { label: 'Owner privacy', state: 'complete' },
      { label: 'Find account', state: 'active' },
      { label: 'Prepare account', state: 'pending' }
    ]);
  });

  it('shows account preparation after the ChainWhisper address is selected but privacy is not ready', () => {
    const progress = resolveWalletOnboardingProgressModel({
      appWalletAddress: '0x2222222222222222222222222222222222222222',
      connectedWithAppWallet: true,
      connectingOwner: false,
      initializingAccount: true,
      ownerAesReady: true,
      ownerWalletConnected: true,
      recoveryChecking: false,
      recoveringAccount: false,
      walletAesReady: false
    });

    expect(progress).toMatchObject({
      active: true,
      title: 'Preparing account',
      detail: 'Preparing private chat and trading access.'
    });
    expect(progress.steps).toEqual([
      { label: 'Owner privacy', state: 'complete' },
      { label: 'Find account', state: 'complete' },
      { label: 'Prepare account', state: 'active' }
    ]);
  });

  it('classifies owner-linked storage for the current owner', () => {
    expect(
      resolveAppWalletSetupStorageKind({
        ownerAddress: '0x1111111111111111111111111111111111111111',
        storageKind: 'owner-aes',
        storageOwnerAddress: '0x1111111111111111111111111111111111111111'
      })
    ).toBe('owner-aes-current-owner');

    expect(
      resolveAppWalletSetupStorageKind({
        ownerAddress: '0x1111111111111111111111111111111111111111',
        storageKind: 'owner-aes',
        storageOwnerAddress: '0x2222222222222222222222222222222222222222'
      })
    ).toBe('owner-aes-other-owner');

    expect(resolveAppWalletSetupStorageKind({ ownerAddress: '', storageKind: 'encrypted' })).toBe('pin-encrypted');
  });

  it('returns a local auto-connect key only for current-owner encrypted storage', () => {
    const storageState = {
      kind: 'owner-aes',
      record: {
        ciphertext: 'encrypted-local-vault',
        iv: 'local-iv',
        ownerAddress: '0x1111111111111111111111111111111111111111',
        scheme: 'owner-aes-gcm-v1',
        version: 1
      }
    } as const;
    const attemptKey = resolveOwnerLocalAccountAutoConnectAttemptKey({
      attemptNonce: 2,
      chainId: COTI_NETWORK.chainIdDecimal,
      initializing: false,
      ownerAddress: '0x1111111111111111111111111111111111111111',
      ownerAesKey: 'owner-aes',
      storageState
    });

    expect(attemptKey).toBe('0x1111111111111111111111111111111111111111:1:local-iv:21:2');
    expect(
      resolveOwnerLocalAccountAutoConnectAttemptKey({
        chainId: COTI_NETWORK.chainIdDecimal,
        initializing: false,
        ownerAddress: '0x1111111111111111111111111111111111111111',
        ownerAesKey: '',
        storageState
      })
    ).toBe('');
    expect(
      resolveOwnerLocalAccountAutoConnectAttemptKey({
        chainId: COTI_NETWORK.chainIdDecimal,
        initializing: false,
        ownerAddress: '0x2222222222222222222222222222222222222222',
        ownerAesKey: 'owner-aes',
        storageState
      })
    ).toBe('');
    expect(
      resolveOwnerLocalAccountAutoConnectAttemptKey({
        chainId: COTI_NETWORK.chainIdDecimal,
        initializing: false,
        ownerAddress: '0x1111111111111111111111111111111111111111',
        ownerAesKey: 'owner-aes',
        ownerWalletConnected: false,
        storageState
      })
    ).toBe('');
    expect(
      resolveOwnerLocalAccountAutoConnectAttemptKey({
        chainId: COTI_NETWORK.chainIdDecimal,
        initializing: false,
        ownerAddress: '0x1111111111111111111111111111111111111111',
        ownerAesKey: 'owner-aes',
        storageState: { kind: 'encrypted', record: { ciphertext: 'x', iterations: 1, iv: 'iv', salt: 'salt', version: 1 } }
      })
    ).toBe('');
  });

  it('returns a one-shot auto-recovery key when owner AES and registry are ready', () => {
    const attemptKey = resolveOwnerRecoveryAutoConnectAttemptKey({
      chainId: COTI_NETWORK.chainIdDecimal,
      hasAesReady: true,
      initializing: false,
      ownerAddress: '0x1111111111111111111111111111111111111111',
      ownerAesKey: 'owner-aes',
      recoveryConfigured: true,
      registryAddress: '0x2222222222222222222222222222222222222222'
    });

    expect(attemptKey).toBe(
      '0x1111111111111111111111111111111111111111:2632500:0x2222222222222222222222222222222222222222:0'
    );
    expect(
      resolveOwnerRecoveryAutoConnectAttemptKey({
        attemptNonce: 0,
        chainId: COTI_NETWORK.chainIdDecimal,
        currentAttemptKey: attemptKey,
        hasAesReady: true,
        initializing: false,
        ownerAddress: '0x1111111111111111111111111111111111111111',
        ownerAesKey: 'owner-aes',
        recoveryConfigured: true,
        registryAddress: '0x2222222222222222222222222222222222222222'
      })
    ).toBe('');
    expect(
      resolveOwnerRecoveryAutoConnectAttemptKey({
        attemptNonce: 1,
        chainId: COTI_NETWORK.chainIdDecimal,
        currentAttemptKey: attemptKey,
        hasAesReady: true,
        initializing: false,
        ownerAddress: '0x1111111111111111111111111111111111111111',
        ownerAesKey: 'owner-aes',
        recoveryConfigured: true,
        registryAddress: '0x2222222222222222222222222222222222222222'
      })
    ).toBe('0x1111111111111111111111111111111111111111:2632500:0x2222222222222222222222222222222222222222:1');
    expect(
      resolveOwnerRecoveryAutoConnectAttemptKey({
        chainId: COTI_NETWORK.chainIdDecimal,
        hasAesReady: true,
        initializing: false,
        ownerAddress: '0x1111111111111111111111111111111111111111',
        ownerAesKey: '',
        recoveryConfigured: true,
        registryAddress: '0x2222222222222222222222222222222222222222'
      })
    ).toBe('');
    expect(
      resolveOwnerRecoveryAutoConnectAttemptKey({
        chainId: COTI_NETWORK.chainIdDecimal,
        hasAesReady: true,
        initializing: false,
        ownerAddress: '0x1111111111111111111111111111111111111111',
        ownerAesKey: 'owner-aes',
        ownerWalletConnected: false,
        recoveryConfigured: true,
        registryAddress: '0x2222222222222222222222222222222222222222'
      })
    ).toBe('');
  });
});

describe('resolveWalletHeaderActionVisibility', () => {
  const walletOptions = [
    { id: 'metamask', label: 'MetaMask' },
    { id: 'ciphertrade', label: 'CipherTrade' }
  ];

  it('shows the preferred browser quick action while disconnected when the primary action is app wallet', () => {
    const result = resolveWalletHeaderActionVisibility({
      appWalletCount: 1,
      browserWalletOptions: walletOptions,
      connectedWithAppWallet: false,
      hasSavedAppWallet: true,
      isConnected: false,
      isOnCotiNetwork: false,
      preferredBrowserWalletId: 'metamask',
      showDisconnectedBrowserAction: true
    });

    expect(result.showBrowserQuickAction).toBe(true);
    expect(result.showDisconnectedBrowserAction).toBe(true);
    expect(result.quickBrowserWalletId).toBe('metamask');
    expect(result.menuBrowserWalletOptions.map((option) => option.id)).toEqual(['ciphertrade']);
  });

  it('shows the saved app-wallet chooser while disconnected when multiple app wallets are visible', () => {
    const result = resolveWalletHeaderActionVisibility({
      appWalletCount: 2,
      browserWalletOptions: walletOptions,
      connectedWithAppWallet: false,
      hasSavedAppWallet: true,
      isConnected: false,
      isOnCotiNetwork: false,
      preferredBrowserWalletId: 'metamask',
      showDisconnectedBrowserAction: true
    });

    expect(result.showAppWalletSwitchButton).toBe(true);
  });

  it('hides the saved app-wallet chooser while disconnected when only one app wallet is visible', () => {
    const result = resolveWalletHeaderActionVisibility({
      appWalletCount: 1,
      browserWalletOptions: walletOptions,
      connectedWithAppWallet: false,
      hasSavedAppWallet: true,
      isConnected: false,
      isOnCotiNetwork: false,
      preferredBrowserWalletId: 'metamask',
      showDisconnectedBrowserAction: true
    });

    expect(result.showAppWalletSwitchButton).toBe(false);
  });

  it('keeps the preferred browser wallet out of the menu when it is already a quick switch action', () => {
    const result = resolveWalletHeaderActionVisibility({
      appWalletCount: 2,
      browserWalletOptions: walletOptions,
      connectedWithAppWallet: true,
      hasSavedAppWallet: true,
      isConnected: true,
      isOnCotiNetwork: true,
      preferredBrowserWalletId: 'metamask',
      showDisconnectedBrowserAction: false
    });

    expect(result.showBrowserQuickAction).toBe(true);
    expect(result.showBrowserSwitchAction).toBe(true);
    expect(result.showAppWalletSwitchButton).toBe(true);
    expect(result.menuBrowserWalletOptions.map((option) => option.id)).toEqual(['ciphertrade']);
  });

  it('offers app wallet switch or creation only from a connected browser wallet on COTI', () => {
    expect(
      resolveWalletHeaderActionVisibility({
        appWalletCount: 1,
        browserWalletOptions: walletOptions,
        connectedWithAppWallet: false,
        hasSavedAppWallet: true,
        isConnected: true,
        isOnCotiNetwork: true,
        preferredBrowserWalletId: 'metamask',
        showDisconnectedBrowserAction: false
      })
    ).toMatchObject({
      showAppCreateAction: false,
      showAppSwitchAction: true
    });

    expect(
      resolveWalletHeaderActionVisibility({
        appWalletCount: 0,
        browserWalletOptions: walletOptions,
        connectedWithAppWallet: false,
        hasSavedAppWallet: false,
        isConnected: true,
        isOnCotiNetwork: true,
        preferredBrowserWalletId: 'metamask',
        showDisconnectedBrowserAction: false
      })
    ).toMatchObject({
      showAppCreateAction: true,
      showAppSwitchAction: false
    });
  });
});

describe('resolveAppWalletSwitchOptions', () => {
  it('keeps the active saved app wallet disabled and other saved wallets selectable by address', () => {
    const firstAddress = '0x1111111111111111111111111111111111111111';
    const secondAddress = '0x2222222222222222222222222222222222222222';
    const options = resolveAppWalletSwitchOptions({
      activeWalletAddress: firstAddress,
      wallets: [
        {
          id: 'wallet-a',
          address: firstAddress,
          name: 'First app wallet',
          privateKey: `0x${'a'.repeat(64)}`
        },
        {
          id: 'wallet-b',
          address: secondAddress,
          name: 'Second app wallet',
          privateKey: `0x${'b'.repeat(64)}`
        }
      ]
    });

    expect(options[0]).toMatchObject({
      active: true,
      disabled: true,
      id: firstAddress,
      label: 'First app wallet active',
      walletId: 'wallet-a'
    });
    expect(options[1]).toMatchObject({
      active: false,
      disabled: false,
      id: secondAddress,
      label: 'Second app wallet',
      walletId: 'wallet-b'
    });
  });
});

describe('app wallet onboarding funding errors', () => {
  it('recognizes zero-balance onboarding failures as funding problems', () => {
    expect(hasInsufficientFundsError('Account balance is 0 so user cannot be onboarded.')).toBe(true);
  });
});

describe('hasSessionAesKey', () => {
  it('reads AES readiness from the normalized wallet key', () => {
    const onboardInfo = { aesKey: 'ready' } as unknown as OnboardInfo;
    expect(hasSessionAesKey(' 0xABC ', { '0xabc': onboardInfo })).toBe(true);
    expect(hasSessionAesKey('0xdef', { '0xabc': onboardInfo })).toBe(false);
  });
});
