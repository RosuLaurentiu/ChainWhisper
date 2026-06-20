import {
  isWalletBootstrapRoute,
  resolveWalletBootstrapTargetPath
} from './walletBootstrapRoute';

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

const sanitizePathForDiagnostics = (pathname: string): string =>
  pathname.toLowerCase().startsWith('/otc/')
    ? '/otc/[route]'
    : pathname.toLowerCase().startsWith('/trades/')
      ? '/trades/[route]'
      : pathname.toLowerCase().startsWith('/otcdesk/')
        ? '/otcdesk/[route]'
        : pathname;

export const getCurrentRouteForDiagnostics = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }
  if (isWalletBootstrapRoute(window.location.pathname)) {
    const activeRoute = resolveWalletBootstrapTargetPath();
    return `/wallet-connect?p=${activeRoute ? sanitizePathForDiagnostics(activeRoute) : '[route]'}`;
  }
  const searchLabel = window.location.search ? '?[params]' : '';
  const hashLabel = window.location.hash ? '#[redacted]' : '';
  return `${sanitizePathForDiagnostics(window.location.pathname)}${searchLabel}${hashLabel}`;
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
