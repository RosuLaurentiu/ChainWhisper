import { describe, expect, it } from 'vitest';
import type { AppPage } from './routing';
import { getAppWalletPolicy } from './walletPolicy';

const appPages: AppPage[] = ['home', 'chat', 'swap', 'trades', 'treasury'];

describe('ChainWhisper account wallet policy', () => {
  it('keeps wallet controls off Home and Treasury', () => {
    expect(getAppWalletPolicy('home')).toMatchObject({
      preferredWallet: 'none',
      walletControlKind: 'none'
    });
    expect(getAppWalletPolicy('treasury')).toMatchObject({
      preferredWallet: 'none',
      walletControlKind: 'none'
    });
  });

  it('uses one ChainWhisper-account-focused header policy for app pages that need wallets', () => {
    for (const page of ['chat', 'swap', 'trades'] satisfies AppPage[]) {
      expect(getAppWalletPolicy(page)).toMatchObject({
        preferredWallet: 'app',
        walletControlKind: 'app'
      });
    }
  });

  it('preserves connected sessions when navigating between every app route', () => {
    for (const fromPage of appPages) {
      for (const toPage of appPages) {
        expect(getAppWalletPolicy(fromPage).preserveConnectedSession, `${fromPage} -> ${toPage}`).toBe(true);
        expect(getAppWalletPolicy(toPage).preserveConnectedSession, `${fromPage} -> ${toPage}`).toBe(true);
      }
    }
  });
});
