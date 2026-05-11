export const WALLET_BOOTSTRAP_PATH = '/wallet-connect';
export const WALLET_BOOTSTRAP_ACTIVE_ROUTE_STORAGE_KEY = 'chainwhisper:wallet-bootstrap-active-route:v1';

type WalletBootstrapRouteStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

type WalletBootstrapRouteRecord = {
  activePath: string;
  entryPath: string;
  timestamp: number;
};

type WalletBootstrapLocation = Pick<Location, 'pathname' | 'search' | 'hash' | 'origin'>;

const DEFAULT_BOOTSTRAP_TARGET_PATH = '/';
const FALLBACK_ORIGIN = 'https://chainwhisper.local';

const normalizeBootstrapPathname = (pathname: string): string => {
  const normalized = pathname.trim().replace(/\/+$/, '');
  return normalized || '/';
};

const isAllowedBootstrapTargetPathname = (pathname: string): boolean => {
  const lowerPathname = normalizeBootstrapPathname(pathname).toLowerCase();
  return (
    lowerPathname === '/' ||
    lowerPathname === '/home' ||
    lowerPathname === '/chat' ||
    lowerPathname === '/messages' ||
    lowerPathname === '/messenger' ||
    lowerPathname === '/shield' ||
    lowerPathname === '/swap' ||
    lowerPathname === '/whisper-shield' ||
    lowerPathname === '/treasury' ||
    lowerPathname === '/treasury-data' ||
    lowerPathname === '/trades' ||
    lowerPathname.startsWith('/trades/')
  );
};

const getWindowLocation = (): WalletBootstrapLocation | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.location;
};

const getSessionStorage = (): WalletBootstrapRouteStorage | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const getOrigin = (location?: Pick<Location, 'origin'> | null): string => {
  const origin = location?.origin || getWindowLocation()?.origin || FALLBACK_ORIGIN;
  return origin || FALLBACK_ORIGIN;
};

export const isWalletBootstrapRoute = (pathname: string): boolean =>
  normalizeBootstrapPathname(pathname).toLowerCase() === WALLET_BOOTSTRAP_PATH;

export const normalizeWalletBootstrapTargetPath = (
  value: string | null | undefined,
  origin = getOrigin()
): string => {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return '';
  }

  try {
    const parsedUrl = new URL(trimmed, origin);
    if (parsedUrl.origin !== origin) {
      return '';
    }

    const pathname = normalizeBootstrapPathname(parsedUrl.pathname);
    if (isWalletBootstrapRoute(pathname) || !isAllowedBootstrapTargetPathname(pathname)) {
      return '';
    }

    return `${pathname}${parsedUrl.search}${parsedUrl.hash}`;
  } catch {
    return '';
  }
};

export const getWalletBootstrapEntryPathFromLocation = (
  location: Pick<Location, 'search' | 'origin'> | null = getWindowLocation()
): string => {
  if (!location) {
    return '';
  }

  try {
    return normalizeWalletBootstrapTargetPath(new URLSearchParams(location.search).get('p'), getOrigin(location));
  } catch {
    return '';
  }
};

export const hasWalletBootstrapEntryParam = (
  location: Pick<Location, 'search'> | null = getWindowLocation()
): boolean => {
  if (!location) {
    return false;
  }

  try {
    return new URLSearchParams(location.search).has('p');
  } catch {
    return false;
  }
};

export const readWalletBootstrapRouteRecord = (
  storage: WalletBootstrapRouteStorage | null = getSessionStorage(),
  origin = getOrigin()
): WalletBootstrapRouteRecord | null => {
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(WALLET_BOOTSTRAP_ACTIVE_ROUTE_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<WalletBootstrapRouteRecord>;
    const activePath = normalizeWalletBootstrapTargetPath(parsed.activePath, origin);
    const entryPath = normalizeWalletBootstrapTargetPath(parsed.entryPath, origin);
    const timestamp = typeof parsed.timestamp === 'number' ? parsed.timestamp : 0;
    if (!activePath || !entryPath || !timestamp) {
      storage.removeItem(WALLET_BOOTSTRAP_ACTIVE_ROUTE_STORAGE_KEY);
      return null;
    }

    return { activePath, entryPath, timestamp };
  } catch {
    try {
      storage?.removeItem(WALLET_BOOTSTRAP_ACTIVE_ROUTE_STORAGE_KEY);
    } catch {
    }
    return null;
  }
};

export const writeWalletBootstrapActiveRoutePath = (
  targetPath: string,
  options: {
    entryPath?: string;
    location?: WalletBootstrapLocation | null;
    now?: number;
    origin?: string;
    storage?: WalletBootstrapRouteStorage | null;
  } = {}
): WalletBootstrapRouteRecord | null => {
  const location = options.location ?? getWindowLocation();
  const origin = options.origin ?? getOrigin(location);
  const storage = options.storage ?? getSessionStorage();
  const activePath = normalizeWalletBootstrapTargetPath(targetPath, origin);
  if (!storage || !activePath) {
    return null;
  }

  const currentEntryPath =
    location && isWalletBootstrapRoute(location.pathname)
      ? getWalletBootstrapEntryPathFromLocation(location)
      : '';
  const previousRecord = readWalletBootstrapRouteRecord(storage, origin);
  const entryPath =
    normalizeWalletBootstrapTargetPath(options.entryPath, origin) ||
    currentEntryPath ||
    previousRecord?.entryPath ||
    activePath;
  const record: WalletBootstrapRouteRecord = {
    activePath,
    entryPath,
    timestamp: options.now ?? Date.now()
  };

  try {
    storage.setItem(WALLET_BOOTSTRAP_ACTIVE_ROUTE_STORAGE_KEY, JSON.stringify(record));
    return record;
  } catch {
    return null;
  }
};

export const resolveWalletBootstrapTargetPath = (
  options: {
    location?: WalletBootstrapLocation | null;
    storage?: WalletBootstrapRouteStorage | null;
  } = {}
): string => {
  const location = options.location ?? getWindowLocation();
  if (!location || !isWalletBootstrapRoute(location.pathname)) {
    return '';
  }

  const origin = getOrigin(location);
  const entryParamPresent = hasWalletBootstrapEntryParam(location);
  const entryPath = getWalletBootstrapEntryPathFromLocation(location);
  const storedRoute = readWalletBootstrapRouteRecord(options.storage ?? getSessionStorage(), origin);

  if (storedRoute && (!entryParamPresent || storedRoute.entryPath === entryPath)) {
    return storedRoute.activePath;
  }

  if (entryPath) {
    return entryPath;
  }

  return DEFAULT_BOOTSTRAP_TARGET_PATH;
};

export const syncWalletBootstrapRouteFromLocation = (
  options: {
    location?: WalletBootstrapLocation | null;
    storage?: WalletBootstrapRouteStorage | null;
  } = {}
): string => {
  const location = options.location ?? getWindowLocation();
  if (!location || !isWalletBootstrapRoute(location.pathname)) {
    return '';
  }

  const targetPath = resolveWalletBootstrapTargetPath({
    location,
    storage: options.storage
  });
  writeWalletBootstrapActiveRoutePath(targetPath, {
    entryPath: getWalletBootstrapEntryPathFromLocation(location) || targetPath,
    location,
    storage: options.storage
  });
  return targetPath;
};

export const buildWalletBootstrapPath = (targetPath: string, origin = getOrigin()): string => {
  const normalizedTargetPath = normalizeWalletBootstrapTargetPath(targetPath, origin) || DEFAULT_BOOTSTRAP_TARGET_PATH;
  return `${WALLET_BOOTSTRAP_PATH}?p=${encodeURIComponent(normalizedTargetPath)}`;
};

export const resolveWalletBootstrapTargetPathFromUrl = (dappUrl: string): string => {
  const trimmed = dappUrl.trim();
  if (!trimmed) {
    return DEFAULT_BOOTSTRAP_TARGET_PATH;
  }

  try {
    const parsedUrl = new URL(trimmed.match(/^https?:\/\//i) ? trimmed : `https://${trimmed}`);
    if (isWalletBootstrapRoute(parsedUrl.pathname)) {
      return normalizeWalletBootstrapTargetPath(
        new URLSearchParams(parsedUrl.search).get('p'),
        parsedUrl.origin
      ) || DEFAULT_BOOTSTRAP_TARGET_PATH;
    }

    return normalizeWalletBootstrapTargetPath(
      `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`,
      parsedUrl.origin
    ) || DEFAULT_BOOTSTRAP_TARGET_PATH;
  } catch {
    return DEFAULT_BOOTSTRAP_TARGET_PATH;
  }
};

export const buildWalletBootstrapDappTargetUrl = (dappUrl: string): string => {
  const trimmed = dappUrl.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const parsedUrl = new URL(trimmed.match(/^https?:\/\//i) ? trimmed : `https://${trimmed}`);
    return `${parsedUrl.host}${buildWalletBootstrapPath(resolveWalletBootstrapTargetPathFromUrl(trimmed), parsedUrl.origin)}`;
  } catch {
    return trimmed.replace(/^https?:\/\//i, '');
  }
};
