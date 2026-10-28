import { useLayoutEffect, useRef, type RefObject } from 'react';

type MessageAnchorItem = {
  id: string;
};

type ScrollSnapshot = {
  threadKey: string;
  ids: string[];
  firstId: string | null;
  lastId: string | null;
  anchorId: string | null;
  anchorOffset: number | null;
  itemCount: number;
  totalSize: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

const readVisibleAnchor = (container: HTMLDivElement, ids: string[]) => {
  const containerTop = container.getBoundingClientRect().top;
  const containerBottom = container.getBoundingClientRect().bottom;
  for (const row of container.querySelectorAll<HTMLElement>('.message-row[data-index]')) {
    const rect = row.getBoundingClientRect();
    if (rect.bottom <= containerTop || rect.top >= containerBottom) {
      continue;
    }

    const index = Number(row.dataset.index);
    const id = Number.isInteger(index) ? ids[index] : undefined;
    if (id) {
      return { id, offset: rect.top - containerTop };
    }
  }

  return null;
};

type UseVirtualizedPrependScrollAnchorOptions<TMessage extends MessageAnchorItem> = {
  messages: TMessage[];
  scrollElementRef: RefObject<HTMLDivElement>;
  threadKey: string;
  totalSize: number;
};

const getLastId = (ids: string[]): string | null => (ids.length > 0 ? ids[ids.length - 1] : null);

export default function useVirtualizedPrependScrollAnchor<TMessage extends MessageAnchorItem>({
  messages,
  scrollElementRef,
  threadKey,
  totalSize
}: UseVirtualizedPrependScrollAnchorOptions<TMessage>) {
  const snapshotRef = useRef<ScrollSnapshot | null>(null);
  const restoreRunIdRef = useRef(0);
  const pendingRestoreRunIdRef = useRef<number | null>(null);
  const pendingRestoreMessagesRef = useRef<TMessage[] | null>(null);
  const pendingRestoreThreadKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const container = scrollElementRef.current;
    if (!container) {
      snapshotRef.current = null;
      return undefined;
    }

    const syncScrollMetrics = () => {
      const snapshot = snapshotRef.current;
      if (!snapshot || snapshot.threadKey !== threadKey) {
        return;
      }

      snapshot.scrollTop = container.scrollTop;
      snapshot.scrollHeight = container.scrollHeight;
      snapshot.clientHeight = container.clientHeight;
      const anchor = readVisibleAnchor(container, snapshot.ids);
      snapshot.anchorId = anchor?.id ?? null;
      snapshot.anchorOffset = anchor?.offset ?? null;
    };

    const cancelPendingRestore = () => {
      if (pendingRestoreRunIdRef.current === null) {
        return;
      }

      restoreRunIdRef.current += 1;
      pendingRestoreRunIdRef.current = null;
      pendingRestoreMessagesRef.current = null;
      pendingRestoreThreadKeyRef.current = null;
    };

    const cancelOnScrollKey = (event: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' '].includes(event.key)) {
        cancelPendingRestore();
      }
    };

    syncScrollMetrics();
    container.addEventListener('scroll', syncScrollMetrics, { passive: true });
    container.addEventListener('wheel', cancelPendingRestore, { passive: true });
    container.addEventListener('touchmove', cancelPendingRestore, { passive: true });
    container.addEventListener('pointerdown', cancelPendingRestore);
    container.addEventListener('keydown', cancelOnScrollKey);
    return () => {
      container.removeEventListener('scroll', syncScrollMetrics);
      container.removeEventListener('wheel', cancelPendingRestore);
      container.removeEventListener('touchmove', cancelPendingRestore);
      container.removeEventListener('pointerdown', cancelPendingRestore);
      container.removeEventListener('keydown', cancelOnScrollKey);
    };
  }, [scrollElementRef, threadKey]);

  useLayoutEffect(() => () => {
    restoreRunIdRef.current += 1;
    pendingRestoreRunIdRef.current = null;
    pendingRestoreMessagesRef.current = null;
    pendingRestoreThreadKeyRef.current = null;
    snapshotRef.current = null;
  }, []);

  useLayoutEffect(() => {
    const keepPendingRestore = pendingRestoreRunIdRef.current !== null &&
      pendingRestoreMessagesRef.current === messages &&
      pendingRestoreThreadKeyRef.current === threadKey;
    if (!keepPendingRestore) {
      restoreRunIdRef.current += 1;
      pendingRestoreRunIdRef.current = null;
      pendingRestoreMessagesRef.current = null;
      pendingRestoreThreadKeyRef.current = null;
    }
    const restoreRunId = restoreRunIdRef.current;
    const container = scrollElementRef.current;
    const ids = messages.map((message) => message.id);
    const firstId = ids.length > 0 ? ids[0] : null;
    const lastId = getLastId(ids);

    if (!container || !threadKey) {
      snapshotRef.current = null;
      return;
    }

    const previous = snapshotRef.current;
    if (previous && previous.threadKey === threadKey && previous.firstId && ids.length > previous.itemCount) {
      const previousFirstNextIndex = ids.indexOf(previous.firstId);
      const previousLastStillPresent = previous.lastId ? ids.includes(previous.lastId) : true;
      const didPrepend = previousFirstNextIndex > 0 && previousLastStillPresent;

      if (didPrepend) {
        const totalSizeDelta = totalSize - previous.totalSize;
        const scrollHeightDelta = container.scrollHeight - previous.scrollHeight;
        const anchorDelta = Math.max(totalSizeDelta, scrollHeightDelta, 0);

        if (anchorDelta > 0) {
          pendingRestoreRunIdRef.current = restoreRunId;
          pendingRestoreMessagesRef.current = messages;
          pendingRestoreThreadKeyRef.current = threadKey;
          const nextScrollTop = previous.scrollTop + anchorDelta;
          container.scrollTop = nextScrollTop;
          const isCurrentRestore = () => restoreRunIdRef.current === restoreRunId &&
            pendingRestoreRunIdRef.current === restoreRunId &&
            snapshotRef.current?.threadKey === threadKey;

          const restoreFromMeasuredAnchor = () => {
            if (!previous.anchorId || previous.anchorOffset === null) {
              return false;
            }

            const anchorIndex = ids.indexOf(previous.anchorId);
            if (anchorIndex < 0) {
              return false;
            }

            const row = container.querySelector<HTMLElement>(`.message-row[data-index="${anchorIndex}"]`);
            if (!row) {
              return false;
            }

            const currentOffset = row.getBoundingClientRect().top - container.getBoundingClientRect().top;
            container.scrollTop += currentOffset - previous.anchorOffset;
            return true;
          };

          requestAnimationFrame(() => {
            if (!isCurrentRestore()) {
              return;
            }

            const measuredDelta = container.scrollHeight - previous.scrollHeight;
            container.scrollTop = previous.scrollTop + Math.max(measuredDelta, 0);

            requestAnimationFrame(() => {
              if (!isCurrentRestore()) {
                return;
              }

              restoreFromMeasuredAnchor();
              window.setTimeout(() => {
                if (!isCurrentRestore()) {
                  return;
                }

                const settledDelta = container.scrollHeight - previous.scrollHeight;
                if (!restoreFromMeasuredAnchor()) {
                  container.scrollTop = previous.scrollTop + Math.max(settledDelta, 0);
                }
                pendingRestoreRunIdRef.current = null;
                pendingRestoreMessagesRef.current = null;
                pendingRestoreThreadKeyRef.current = null;
              }, 0);
            });
          });
        }
      }
    }

    snapshotRef.current = {
      threadKey,
      ids,
      firstId,
      lastId,
      anchorId: null,
      anchorOffset: null,
      itemCount: ids.length,
      totalSize,
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight
    };
    const anchor = readVisibleAnchor(container, ids);
    snapshotRef.current.anchorId = anchor?.id ?? null;
    snapshotRef.current.anchorOffset = anchor?.offset ?? null;
  }, [messages, scrollElementRef, threadKey, totalSize]);
}
