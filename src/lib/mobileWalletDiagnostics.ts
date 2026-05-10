const MOBILE_WALLET_DIAGNOSTICS_KEY = 'chainwhisper:mobile-wallet-diagnostics';

const readDiagnosticsFlag = (storage?: Storage | null): boolean => {
  try {
    return storage?.getItem(MOBILE_WALLET_DIAGNOSTICS_KEY) === '1';
  } catch {
    return false;
  }
};

export const isMobileWalletDiagnosticsEnabled = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  return readDiagnosticsFlag(window.sessionStorage) || readDiagnosticsFlag(window.localStorage);
};

export const maskWalletForDiagnostics = (value?: string | null): string => {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length < 10) {
    return trimmed ? '[set]' : '';
  }
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
};

export const getCurrentRouteForDiagnostics = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
};

export const logMobileWalletDiagnostic = (event: string, detail: Record<string, unknown> = {}): void => {
  if (!isMobileWalletDiagnosticsEnabled()) {
    return;
  }
  console.info('[ChainWhisper mobile wallet]', event, {
    route: getCurrentRouteForDiagnostics(),
    ...detail
  });
};
