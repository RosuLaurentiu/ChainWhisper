import { describe, expect, it } from 'vitest';
import { selectBurnerWalletFromVault } from './burnerWalletVault';
import type { BurnerWalletVault } from './appShared';

const makeVault = (): BurnerWalletVault => ({
  version: 1,
  activeWalletId: 'wallet-a',
  wallets: [
    {
      id: 'wallet-a',
      address: '0x1111111111111111111111111111111111111111',
      privateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    },
    {
      id: 'wallet-b',
      address: '0x2222222222222222222222222222222222222222',
      privateKey: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    }
  ]
});

describe('burner wallet vault helpers', () => {
  it('selects a wallet by id', () => {
    expect(selectBurnerWalletFromVault(makeVault(), 'wallet-b')?.id).toBe('wallet-b');
  });

  it('selects a wallet by address case-insensitively', () => {
    expect(selectBurnerWalletFromVault(makeVault(), '0x2222222222222222222222222222222222222222')?.id).toBe('wallet-b');
  });

  it('falls back to the active wallet', () => {
    expect(selectBurnerWalletFromVault(makeVault(), 'missing')?.id).toBe('wallet-a');
  });
});
