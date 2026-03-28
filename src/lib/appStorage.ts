import { isWalletAddress } from './appShared';

type GroupRemovalNoticeMarkerMap = Record<string, Record<string, string>>;

type GroupRemovalNoticeMarkerArgs = {
  groupRemovalNoticeMarkersLoadedRef: { current: boolean };
  groupRemovalNoticeMarkersRef: { current: GroupRemovalNoticeMarkerMap };
  storageKey: string;
};

export const ensureGroupRemovalNoticeMarkersLoaded = ({
  groupRemovalNoticeMarkersLoadedRef,
  groupRemovalNoticeMarkersRef,
  storageKey
}: GroupRemovalNoticeMarkerArgs): void => {
  if (groupRemovalNoticeMarkersLoadedRef.current) {
    return;
  }
  groupRemovalNoticeMarkersLoadedRef.current = true;
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return;
    }

    const normalized: GroupRemovalNoticeMarkerMap = {};
    for (const [walletKey, markerMap] of Object.entries(parsed)) {
      if (!isWalletAddress(walletKey) || !markerMap || typeof markerMap !== 'object' || Array.isArray(markerMap)) {
        continue;
      }
      const nextMarkerMap: Record<string, string> = {};
      for (const [groupId, marker] of Object.entries(markerMap)) {
        if (!/^\d+$/.test(groupId) || typeof marker !== 'string' || marker.length === 0) {
          continue;
        }
        nextMarkerMap[groupId] = marker;
      }
      if (Object.keys(nextMarkerMap).length > 0) {
        normalized[walletKey] = nextMarkerMap;
      }
    }
    groupRemovalNoticeMarkersRef.current = normalized;
  } catch {
  }
};

export const getStoredGroupRemovalNoticeMarker = (
  walletKey: string,
  groupId: number,
  args: GroupRemovalNoticeMarkerArgs
): string | undefined => {
  ensureGroupRemovalNoticeMarkersLoaded(args);
  return args.groupRemovalNoticeMarkersRef.current[walletKey]?.[String(groupId)];
};

export const setStoredGroupRemovalNoticeMarker = (
  walletKey: string,
  groupId: number,
  marker: string,
  args: GroupRemovalNoticeMarkerArgs
): void => {
  ensureGroupRemovalNoticeMarkersLoaded(args);
  const walletMarkers =
    args.groupRemovalNoticeMarkersRef.current[walletKey] ??
    (args.groupRemovalNoticeMarkersRef.current[walletKey] = {});
  walletMarkers[String(groupId)] = marker;
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(args.storageKey, JSON.stringify(args.groupRemovalNoticeMarkersRef.current));
  } catch {
  }
};
