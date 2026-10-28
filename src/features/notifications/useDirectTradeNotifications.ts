import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DirectTradeV2ChatEntry } from '../../lib/directTradeV2ChatProjection';
import {
  buildDirectTradeNotificationStorageKey,
  markDirectTradeNotificationsRead,
  parseDirectTradeNotifications,
  reconcileDirectTradeNotifications,
  serializeDirectTradeNotifications,
  type DirectTradeNotificationItem,
  type DirectTradeNotificationScope
} from './directTradeNotifications';

const readStored = (key: string): readonly DirectTradeNotificationItem[] => {
  try {
    return parseDirectTradeNotifications(window.localStorage.getItem(key));
  } catch {
    return Object.freeze([]);
  }
};

export default function useDirectTradeNotifications(scope: DirectTradeNotificationScope | null) {
  const storageKey = useMemo(() => scope ? buildDirectTradeNotificationStorageKey(scope) : '', [scope]);
  const [items, setItems] = useState<readonly DirectTradeNotificationItem[]>([]);

  useEffect(() => {
    if (!storageKey) {
      setItems([]);
      return undefined;
    }
    setItems(readStored(storageKey));
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) setItems(parseDirectTradeNotifications(event.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);

  const persist = useCallback((next: readonly DirectTradeNotificationItem[]) => {
    setItems(next);
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, serializeDirectTradeNotifications(next));
    } catch {
      // Notifications remain usable in memory when storage is unavailable.
    }
  }, [storageKey]);

  const ingest = useCallback(({
    newOpenings,
    canonicalOpenings,
    canonicalComplete
  }: {
    newOpenings: readonly DirectTradeV2ChatEntry[];
    canonicalOpenings: readonly DirectTradeV2ChatEntry[];
    canonicalComplete: boolean;
  }) => {
    if (!scope) return;
    setItems((previous) => {
      const next = reconcileDirectTradeNotifications({
        scope,
        previous,
        newOpenings,
        canonicalOpenings,
        canonicalComplete
      });
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, serializeDirectTradeNotifications(next));
        } catch {
          // Keep the canonical in-memory result.
        }
      }
      return next;
    });
  }, [scope, storageKey]);

  const markRead = useCallback((id?: string) => {
    setItems((previous) => {
      const next = markDirectTradeNotificationsRead(previous, id);
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, serializeDirectTradeNotifications(next));
        } catch {
          // Keep the read state for this session.
        }
      }
      return next;
    });
  }, [storageKey]);

  const clear = useCallback(() => persist(Object.freeze([])), [persist]);

  return Object.freeze({
    items,
    unreadCount: items.filter((item) => !item.read).length,
    ingest,
    markRead,
    clear
  });
}
