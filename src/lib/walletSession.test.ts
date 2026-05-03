import { describe, expect, it } from 'vitest';
import type { OnboardInfo } from '@coti-io/coti-ethers';
import { COTI_NETWORK } from './appShared/core';
import {
  hasSessionAesKey,
  resolveWalletBlockedActionLabel,
  resolveWalletModeLabel,
  resolveWalletPrimaryButtonClassName,
  resolveWalletPrimaryButtonLabel,
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
});

describe('hasSessionAesKey', () => {
  it('reads AES readiness from the normalized wallet key', () => {
    const onboardInfo = { aesKey: 'ready' } as unknown as OnboardInfo;
    expect(hasSessionAesKey(' 0xABC ', { '0xabc': onboardInfo })).toBe(true);
    expect(hasSessionAesKey('0xdef', { '0xabc': onboardInfo })).toBe(false);
  });
});
