import { describe, expect, it } from 'vitest';
import type { AppPage } from './routing';
import { getAppWalletPolicy } from './walletPolicy';

const appPages: AppPage[] = ['home', 'chat', 'swap', 'trades', 'treasury'];

describe('app wallet policy', () => {
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

  it('keeps Chat and WISP Portal app-wallet focused', () => {
    expect(getAppWalletPolicy('chat')).toMatchObject({
      preferredWallet: 'app',
      walletControlKind: 'chat'
    });
    expect(getAppWalletPolicy('swap')).toMatchObject({
      preferredWallet: 'app',
      walletControlKind: 'chat'
    });
  });

  it('keeps OTC Desk browser-wallet focused', () => {
    expect(getAppWalletPolicy('trades')).toMatchObject({
      preferredWallet: 'browser',
      walletControlKind: 'trades'
    });
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
