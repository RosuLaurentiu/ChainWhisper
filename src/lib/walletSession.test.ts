import { describe, expect, it } from 'vitest';
import type { OnboardInfo } from '@coti-io/coti-ethers';
import { COTI_NETWORK, hasInsufficientFundsError } from './appShared/core';
import {
  hasSessionAesKey,
  resolveAppWalletSwitchOptions,
  resolveWalletBlockedActionLabel,
  resolveWalletHeaderActionVisibility,
  resolveWalletHeaderViewModel,
  resolveWalletModeLabel,
  resolveWalletPrimaryButtonClassName,
  resolveWalletPrimaryButtonLabel,
  resolveWalletPrivacyDisplayState,
  resolveWalletPrivacyUnlockPrompt,
  resolveWalletReadiness
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
  it('describes app, browser, and warm secondary wallet modes consistently', () => {
    expect(
      resolveWalletModeLabel({
        connectedWithAppWallet: true,
        hasBrowserWalletAvailable: true,
        walletAddress: '0xabc',
        appWithBrowserLabel: 'MetaMask'
      })
    ).toBe('App + MetaMask');
    expect(
      resolveWalletModeLabel({
        connectedWithAppWallet: false,
        browserWalletLabel: 'CipherTrade',
        hasAppWalletAvailable: true,
        walletAddress: '0xabc'
      })
    ).toBe('CipherTrade + app');
    expect(resolveWalletModeLabel({ connectedWithAppWallet: false, walletAddress: '' })).toBe('No wallet connected');
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

  it('uses the same blocked-action labels for Shield and wallet panels', () => {
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
      title: 'COTI Snap is installed. Click to read the AES key for this MetaMask wallet.'
    });
    expect(
      resolveWalletPrivacyUnlockPrompt({
        hasAesReady: false,
        snapStatus: 'installed-aes-missing',
        unlocking: false
      }).title
    ).toContain('Onboard it in the COTI Snap wallet');
    expect(
      resolveWalletPrivacyUnlockPrompt({
        hasAesReady: false,
        snapStatus: 'unsupported',
        unlocking: false
      }).title
    ).toContain('fallback');
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
      showPrivacyAction: true
    });
  });

  it('keeps the AES status ready while surfacing private-token refresh as an action', () => {
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
      showPrivacyAction: true
    });
  });

  it('keeps Trades browser-first and Chat app-first policies explicit in the model', () => {
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
