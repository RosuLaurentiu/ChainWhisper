import { readOfficialPrivateTvlSnapshot } from '../../lib/appChain';
import type { PrivateTvlSnapshot } from '../../lib/privateTvl';

const PRIVATE_TVL_CACHE_TTL_MS = 30_000;

let privateTvlCache: Readonly<{ snapshot: PrivateTvlSnapshot; loadedAt: number }> | null = null;
let privateTvlRequest: Promise<PrivateTvlSnapshot> | null = null;

export const loadPrivateTvlData = async ({
  forceRefresh = false
}: {
  forceRefresh?: boolean;
} = {}): Promise<PrivateTvlSnapshot> => {
  const now = Date.now();
  if (!forceRefresh && privateTvlCache && now - privateTvlCache.loadedAt < PRIVATE_TVL_CACHE_TTL_MS) {
    return privateTvlCache.snapshot;
  }
  if (privateTvlRequest) return privateTvlRequest;
  privateTvlRequest = readOfficialPrivateTvlSnapshot()
    .then((snapshot) => {
      privateTvlCache = Object.freeze({ snapshot, loadedAt: Date.now() });
      return snapshot;
    })
    .finally(() => {
      privateTvlRequest = null;
    });
  return privateTvlRequest;
};

export const preloadPrivateTvlData = (): Promise<PrivateTvlSnapshot> => loadPrivateTvlData();

export const clearPrivateTvlDataCache = (): void => {
  privateTvlCache = null;
};

