import { describe, expect, it } from 'vitest';
import type { InjectedWalletOption } from './appShared';
import { filterAllowedBrowserWalletOptions, isCypherTradeWalletOption } from './walletOptions';

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
});
