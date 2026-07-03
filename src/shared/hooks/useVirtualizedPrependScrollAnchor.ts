import { useLayoutEffect, useRef, type RefObject } from 'react';

type MessageAnchorItem = {
  id: string;
};

type ScrollSnapshot = {
  threadKey: string;
  firstId: string | null;
  lastId: string | null;
  itemCount: number;
  totalSize: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
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
    };

    syncScrollMetrics();
    container.addEventListener('scroll', syncScrollMetrics, { passive: true });
    return () => {
      container.removeEventListener('scroll', syncScrollMetrics);
    };
  }, [scrollElementRef, threadKey]);

  useLayoutEffect(() => {
    restoreRunIdRef.current += 1;
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
          const nextScrollTop = previous.scrollTop + anchorDelta;
          container.scrollTop = nextScrollTop;

          requestAnimationFrame(() => {
            if (restoreRunIdRef.current !== restoreRunId || snapshotRef.current?.threadKey !== threadKey) {
              return;
            }

            const measuredDelta = container.scrollHeight - previous.scrollHeight;
            container.scrollTop = previous.scrollTop + Math.max(measuredDelta, anchorDelta, 0);

            window.setTimeout(() => {
              if (restoreRunIdRef.current !== restoreRunId || snapshotRef.current?.threadKey !== threadKey) {
                return;
              }

              const settledDelta = container.scrollHeight - previous.scrollHeight;
              container.scrollTop = previous.scrollTop + Math.max(settledDelta, measuredDelta, anchorDelta, 0);
            }, 0);
          });
        }
      }
    }

    snapshotRef.current = {
      threadKey,
      firstId,
      lastId,
      itemCount: ids.length,
      totalSize,
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight
    };
  }, [messages, scrollElementRef, threadKey, totalSize]);
}
