import type { AppPage } from './routing';

export type AppWalletControlKind = 'none' | 'chat' | 'trades';
export type AppWalletPreference = 'none' | 'app' | 'browser';

export type AppWalletPolicy = {
  preserveConnectedSession: true;
  preferredWallet: AppWalletPreference;
  walletControlKind: AppWalletControlKind;
};

const APP_WALLET_POLICIES: Record<AppPage, AppWalletPolicy> = {
  home: {
    preserveConnectedSession: true,
    preferredWallet: 'none',
    walletControlKind: 'none'
  },
  chat: {
    preserveConnectedSession: true,
    preferredWallet: 'app',
    walletControlKind: 'chat'
  },
  swap: {
    preserveConnectedSession: true,
    preferredWallet: 'app',
    walletControlKind: 'chat'
  },
  trades: {
    preserveConnectedSession: true,
    preferredWallet: 'browser',
    walletControlKind: 'trades'
  },
  treasury: {
    preserveConnectedSession: true,
    preferredWallet: 'none',
    walletControlKind: 'none'
  }
};

export const getAppWalletPolicy = (page: AppPage): AppWalletPolicy => APP_WALLET_POLICIES[page];

