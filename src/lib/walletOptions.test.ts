import { describe, expect, it } from 'vitest';
import type { InjectedWalletOption } from './appShared';
import {
  buildMetaMaskMobileDeepLink,
  filterAllowedBrowserWalletOptions,
  isCypherTradeWalletOption,
  isMobileBrowserUserAgent
} from './walletOptions';

const provider = (flags: Record<string, boolean> = {}) => ({
  request: async () => [],
  ...flags
});

const option = (
  id: string,
  label: string,
  flags: Record<string, boolean> = {}
): InjectedWalletOption => ({
  id,
  label,
  provider: provider(flags)
});

describe('walletOptions', () => {
  it('detects CipherTrade by current spelling', () => {
    expect(isCypherTradeWalletOption(option('ciphertrade', 'CipherTrade'))).toBe(true);
    expect(isCypherTradeWalletOption(option('browser-wallet', 'Cipher Wallet'))).toBe(true);
  });

  it('keeps the old CypherTrade spelling as an alias', () => {
    expect(isCypherTradeWalletOption(option('cyphertrade', 'CypherTrade'))).toBe(true);
    expect(isCypherTradeWalletOption(option('browser-wallet', 'Cypher Wallet'))).toBe(true);
  });

  it('detects both CipherTrade and legacy CypherTrade provider flags', () => {
    expect(isCypherTradeWalletOption(option('browser-wallet', 'Browser Wallet', { isCipherTrade: true }))).toBe(true);
    expect(isCypherTradeWalletOption(option('browser-wallet', 'Browser Wallet', { isCypherTrade: true }))).toBe(true);
  });

  it('allows MetaMask and CipherTrade but filters Brave Wallet', () => {
    const options = [
      option('brave-wallet', 'Brave Wallet', { isMetaMask: true, isBraveWallet: true }),
      option('metamask', 'MetaMask', { isMetaMask: true }),
      option('ciphertrade', 'CipherTrade')
    ];

    expect(filterAllowedBrowserWalletOptions(options).map((wallet) => wallet.id)).toEqual(['metamask', 'ciphertrade']);
  });

  it('detects mobile browsers for wallet-app guidance', () => {
    expect(isMobileBrowserUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile')).toBe(true);
    expect(isMobileBrowserUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
  });

  it('builds a documented MetaMask mobile dapp deeplink through the app bootstrap for trade routes', () => {
    expect(buildMetaMaskMobileDeepLink('https://chainwhisper.example/trades/open/1?escrow=direct#secret')).toBe(
      'https://link.metamask.io/dapp/chainwhisper.example/wallet-connect?p=%2Ftrades%2Fopen%2F1%3Fescrow%3Ddirect%23secret'
    );
  });

  it('builds non-trade MetaMask mobile dapp deeplinks through the app bootstrap', () => {
    expect(buildMetaMaskMobileDeepLink('https://chainwhisper.example/chat')).toBe(
      'https://link.metamask.io/dapp/chainwhisper.example/wallet-connect?p=%2Fchat'
    );
  });
});
