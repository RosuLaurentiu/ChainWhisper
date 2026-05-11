export const WALLET_BOOTSTRAP_PATH = '/wallet-connect';
export const WALLET_BOOTSTRAP_ACTIVE_ROUTE_STORAGE_KEY = 'chainwhisper:wallet-bootstrap-active-route:v1';
export const WALLET_BOOTSTRAP_PERSISTED_ROUTE_STORAGE_KEY = 'chainwhisper:wallet-bootstrap-persisted-route:v1';
export const WALLET_BOOTSTRAP_HISTORY_STATE_KEY = 'chainwhisperWalletBootstrapRoute';

type WalletBootstrapRouteStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

type WalletBootstrapRouteRecord = {
  activePath: string;
  entryPath: string;
  timestamp: number;
};

type WalletBootstrapLocation = Pick<Location, 'pathname' | 'search' | 'hash' | 'origin'>;
type WalletBootstrapHistory = Pick<History, 'pushState' | 'replaceState' | 'state'>;
type WalletBootstrapHistoryState = Record<string, unknown> & {
  [WALLET_BOOTSTRAP_HISTORY_STATE_KEY]?: Partial<WalletBootstrapRouteRecord>;
};

const DEFAULT_BOOTSTRAP_TARGET_PATH = '/';
const DEFAULT_METAMASK_MOBILE_BOOTSTRAP_TARGET_PATH = '/trades';
const FALLBACK_ORIGIN = 'https://chainwhisper.local';
const MOBILE_WALLET_DIAGNOSTICS_KEY = 'chainwhisper:mobile-wallet-diagnostics';
const PERSISTED_BOOTSTRAP_ROUTE_TTL_MS = 24 * 60 * 60 * 1000;

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

const getLocalStorage = (): WalletBootstrapRouteStorage | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const getHistory = (): WalletBootstrapHistory | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.history;
  } catch {
    return null;
  }
};

const getOrigin = (location?: Pick<Location, 'origin'> | null): string => {
  const origin = location?.origin || getWindowLocation()?.origin || FALLBACK_ORIGIN;
  return origin || FALLBACK_ORIGIN;
};

const readDiagnosticsFlag = (storage?: WalletBootstrapRouteStorage | null): boolean => {
  try {
    return storage?.getItem(MOBILE_WALLET_DIAGNOSTICS_KEY) === '1';
  } catch {
    return false;
  }
};

const isBootstrapDiagnosticsEnabled = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  return readDiagnosticsFlag(window.sessionStorage) || readDiagnosticsFlag(window.localStorage);
};

const sanitizeBootstrapPathForDiagnostics = (path: string): string => {
  const pathname = path.split('?')[0]?.split('#')[0] ?? path;
  return pathname.toLowerCase().startsWith('/trades/') ? '/trades/[route]' : path.replace(/#.+$/, '#[redacted]');
};

const logWalletBootstrapDiagnostic = (event: string, detail: Record<string, unknown> = {}): void => {
  if (!isBootstrapDiagnosticsEnabled()) {
    return;
  }
  console.info('[ChainWhisper mobile wallet]', event, detail);
};

const getNavigatorUserAgent = (): string => {
  const maybeNavigator = globalThis as { navigator?: { userAgent?: unknown } };
  return typeof maybeNavigator.navigator?.userAgent === 'string' ? maybeNavigator.navigator.userAgent : '';
};

export const isMetaMaskMobileUserAgent = (userAgent = getNavigatorUserAgent()): boolean =>
  /metamaskmobile|metamask/i.test(userAgent) && /android|iphone|ipad|ipod|mobile/i.test(userAgent);

export const isWalletBootstrapRoute = (pathname: string): boolean =>
  normalizeBootstrapPathname(pathname).toLowerCase() === WALLET_BOOTSTRAP_PATH;

export const isWalletBootstrapStableUrl = (pathname: string, search = ''): boolean =>
  isWalletBootstrapRoute(pathname) && !hasWalletBootstrapEntryParam({ search });

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

const normalizeRouteRecord = (
  value: Partial<WalletBootstrapRouteRecord> | null | undefined,
  origin = getOrigin(),
  options: { maxAgeMs?: number; now?: number } = {}
): WalletBootstrapRouteRecord | null => {
  const activePath = normalizeWalletBootstrapTargetPath(value?.activePath, origin);
  const entryPath = normalizeWalletBootstrapTargetPath(value?.entryPath, origin);
  const timestamp = typeof value?.timestamp === 'number' ? value.timestamp : 0;
  if (options.maxAgeMs && (!timestamp || (options.now ?? Date.now()) - timestamp > options.maxAgeMs)) {
    return null;
  }
  return activePath && entryPath && timestamp ? { activePath, entryPath, timestamp } : null;
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

export const readWalletBootstrapHistoryRouteRecord = (
  state: unknown = getHistory()?.state,
  origin = getOrigin()
): WalletBootstrapRouteRecord | null => {
  if (!state || typeof state !== 'object') {
    return null;
  }
  return normalizeRouteRecord((state as WalletBootstrapHistoryState)[WALLET_BOOTSTRAP_HISTORY_STATE_KEY], origin);
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
    const record = normalizeRouteRecord(parsed, origin);
    if (!record) {
      storage.removeItem(WALLET_BOOTSTRAP_ACTIVE_ROUTE_STORAGE_KEY);
      return null;
    }

    return record;
  } catch {
    try {
      storage?.removeItem(WALLET_BOOTSTRAP_ACTIVE_ROUTE_STORAGE_KEY);
    } catch {
    }
    return null;
  }
};

export const readWalletBootstrapPersistedRouteRecord = (
  storage: WalletBootstrapRouteStorage | null = getLocalStorage(),
  origin = getOrigin(),
  now = Date.now()
): WalletBootstrapRouteRecord | null => {
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(WALLET_BOOTSTRAP_PERSISTED_ROUTE_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<WalletBootstrapRouteRecord>;
    const record = normalizeRouteRecord(parsed, origin, {
      maxAgeMs: PERSISTED_BOOTSTRAP_ROUTE_TTL_MS,
      now
    });
    if (!record) {
      storage.removeItem(WALLET_BOOTSTRAP_PERSISTED_ROUTE_STORAGE_KEY);
      return null;
    }

    return record;
  } catch {
    try {
      storage?.removeItem(WALLET_BOOTSTRAP_PERSISTED_ROUTE_STORAGE_KEY);
    } catch {
    }
    return null;
  }
};

const writeWalletBootstrapPersistedRouteRecord = (
  record: WalletBootstrapRouteRecord,
  storage: WalletBootstrapRouteStorage | null = getLocalStorage()
): void => {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(WALLET_BOOTSTRAP_PERSISTED_ROUTE_STORAGE_KEY, JSON.stringify(record));
  } catch {
  }
};

const shouldUseStoredRouteRecord = (
  record: WalletBootstrapRouteRecord | null,
  entryParamPresent: boolean,
  entryPath: string
): record is WalletBootstrapRouteRecord => Boolean(record && (!entryParamPresent || record.entryPath === entryPath));

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
    writeWalletBootstrapPersistedRouteRecord(record);
    return record;
  } catch {
    writeWalletBootstrapPersistedRouteRecord(record);
    return null;
  }
};

const mergeHistoryState = (
  state: unknown,
  record: WalletBootstrapRouteRecord
): WalletBootstrapHistoryState => {
  const base = state && typeof state === 'object' ? { ...(state as Record<string, unknown>) } : {};
  return {
    ...base,
    [WALLET_BOOTSTRAP_HISTORY_STATE_KEY]: record
  };
};

export const writeWalletBootstrapActiveRouteState = (
  targetPath: string,
  options: {
    entryPath?: string;
    history?: WalletBootstrapHistory | null;
    location?: WalletBootstrapLocation | null;
    now?: number;
    origin?: string;
    replace?: boolean;
    storage?: WalletBootstrapRouteStorage | null;
    updateHistory?: boolean;
  } = {}
): WalletBootstrapRouteRecord | null => {
  const location = options.location ?? getWindowLocation();
  const origin = options.origin ?? getOrigin(location);
  const record = writeWalletBootstrapActiveRoutePath(targetPath, {
    entryPath: options.entryPath,
    location,
    now: options.now,
    origin,
    storage: options.storage
  });
  if (!record || options.updateHistory === false) {
    return record;
  }

  const history = options.history ?? getHistory();
  if (!history) {
    return record;
  }

  const nextState = mergeHistoryState(history.state, record);
  try {
    const update = options.replace ? history.replaceState.bind(history) : history.pushState.bind(history);
    update(nextState, '', WALLET_BOOTSTRAP_PATH);
    logWalletBootstrapDiagnostic('bootstrap-route-state-updated', {
      mode: options.replace ? 'replace' : 'push',
      routeKey: sanitizeBootstrapPathForDiagnostics(record.activePath)
    });
  } catch {
  }

  return record;
};

export const resolveWalletBootstrapActiveRoute = (
  options: {
    historyState?: unknown;
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
  const historyRoute = readWalletBootstrapHistoryRouteRecord(options.historyState ?? getHistory()?.state, origin);
  const storedRoute = readWalletBootstrapRouteRecord(options.storage ?? getSessionStorage(), origin);
  const persistedRoute = readWalletBootstrapPersistedRouteRecord(getLocalStorage(), origin);

  if (shouldUseStoredRouteRecord(historyRoute, entryParamPresent, entryPath)) {
    return historyRoute.activePath;
  }

  if (shouldUseStoredRouteRecord(storedRoute, entryParamPresent, entryPath)) {
    return storedRoute.activePath;
  }

  if (shouldUseStoredRouteRecord(persistedRoute, entryParamPresent, entryPath)) {
    return persistedRoute.activePath;
  }

  if (entryPath) {
    return entryPath;
  }

  return DEFAULT_BOOTSTRAP_TARGET_PATH;
};

export const resolveWalletBootstrapTargetPath = resolveWalletBootstrapActiveRoute;

export const syncWalletBootstrapRouteFromLocation = (
  options: {
    history?: WalletBootstrapHistory | null;
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
  writeWalletBootstrapActiveRouteState(targetPath, {
    entryPath: getWalletBootstrapEntryPathFromLocation(location) || targetPath,
    history: options.history,
    location,
    replace: true,
    storage: options.storage
  });
  return targetPath;
};

export const freezeWalletBootstrapUrlAfterEntry = (
  options: {
    history?: WalletBootstrapHistory | null;
    location?: WalletBootstrapLocation | null;
    storage?: WalletBootstrapRouteStorage | null;
  } = {}
): string => {
  const location = options.location ?? getWindowLocation();
  if (!location || !isWalletBootstrapRoute(location.pathname)) {
    return '';
  }

  const entryPath = getWalletBootstrapEntryPathFromLocation(location);
  if (entryPath) {
    logWalletBootstrapDiagnostic('bootstrap-entry-parsed', {
      routeKey: sanitizeBootstrapPathForDiagnostics(entryPath)
    });
  }

  const wasStable = isWalletBootstrapStableUrl(location.pathname, location.search) && !location.hash;
  const targetPath = resolveWalletBootstrapActiveRoute({
    location,
    storage: options.storage
  });
  writeWalletBootstrapActiveRouteState(targetPath, {
    entryPath: entryPath || targetPath,
    history: options.history,
    location,
    replace: true,
    storage: options.storage
  });

  if (!wasStable) {
    logWalletBootstrapDiagnostic('bootstrap-url-frozen', {
      routeKey: sanitizeBootstrapPathForDiagnostics(targetPath)
    });
  }

  return targetPath;
};

export const freezeDirectMetaMaskMobileRoute = (
  options: {
    history?: WalletBootstrapHistory | null;
    location?: WalletBootstrapLocation | null;
    storage?: WalletBootstrapRouteStorage | null;
    userAgent?: string;
  } = {}
): string => {
  const location = options.location ?? getWindowLocation();
  if (!location || !isMetaMaskMobileUserAgent(options.userAgent)) {
    return '';
  }

  if (isWalletBootstrapRoute(location.pathname)) {
    return freezeWalletBootstrapUrlAfterEntry(options);
  }

  const directTargetPath = normalizeWalletBootstrapTargetPath(
    `${location.pathname}${location.search}${location.hash}`,
    getOrigin(location)
  );
  const restoredPath =
    readWalletBootstrapHistoryRouteRecord((options.history ?? getHistory())?.state, getOrigin(location))?.activePath ||
    readWalletBootstrapRouteRecord(options.storage ?? getSessionStorage(), getOrigin(location))?.activePath ||
    readWalletBootstrapPersistedRouteRecord(getLocalStorage(), getOrigin(location))?.activePath ||
    '';
  const targetPath =
    directTargetPath === '/'
      ? restoredPath && restoredPath !== '/'
        ? restoredPath
        : DEFAULT_METAMASK_MOBILE_BOOTSTRAP_TARGET_PATH
      : directTargetPath;
  if (!targetPath) {
    return '';
  }

  writeWalletBootstrapActiveRouteState(targetPath, {
    entryPath: targetPath,
    history: options.history,
    location,
    replace: true,
    storage: options.storage
  });
  logWalletBootstrapDiagnostic('bootstrap-url-frozen', {
    reason: 'direct-metamask-mobile-route',
    routeKey: sanitizeBootstrapPathForDiagnostics(targetPath)
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
