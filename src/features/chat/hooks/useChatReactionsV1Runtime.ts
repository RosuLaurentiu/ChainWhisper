import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../../../lib/appShared';
import {
  compareChatReactionObservationOrder,
  type ChatReactionObservation,
  type ChatReactionSource
} from '../../../lib/chatReactionsV1';
import {
  collectChatReactionSources,
  retainPendingChatReactionStates
} from '../../../lib/chatReactionsV1Messages';
import type {
  ChatReactionWriteResult
} from '../../../lib/chatReactionsV1Actions';
import type { ChatReactionsV1Runtime } from '../../../lib/chatReactionsV1Runtime';

const REACTION_SYNC_INTERVAL_MS = 12_000;

export default function useChatReactionsV1Runtime({
  activeThreadMessages,
  runtime,
  deferSync
}: {
  activeThreadMessages: readonly ChatMessage[];
  runtime: ChatReactionsV1Runtime | null;
  deferSync: boolean;
}) {
  const sourceProjection = useMemo(() => {
    try {
      const sources = collectChatReactionSources(activeThreadMessages);
      return { sources, error: null as string | null };
    } catch {
      return {
        sources: Object.freeze([]) as readonly ChatReactionSource[],
        error: 'Finalized chat message anchors are inconsistent.'
      };
    }
  }, [activeThreadMessages]);
  const sourceFingerprint = useMemo(() => sourceProjection.sources.map((source) => [
    source.kind,
    source.chainId,
    source.contractAddress,
    source.conversationId ?? source.groupId,
    source.messageId,
    source.blockNumber,
    source.blockHash,
    source.transactionHash,
    source.logIndex
  ].join(':')).join('|'), [sourceProjection.sources]);
  const sourcesRef = useRef(sourceProjection.sources);
  sourcesRef.current = sourceProjection.sources;
  const viewRef = useRef({ runtime, sourceFingerprint, deferSync });
  viewRef.current = { runtime, sourceFingerprint, deferSync };
  const [canonicalResult, setCanonicalResult] = useState<{
    runtime: ChatReactionsV1Runtime | null; sourceFingerprint: string; states: readonly ChatReactionObservation[];
  }>({ runtime: null, sourceFingerprint: '', states: [] });
  const canonicalStates = canonicalResult.runtime === runtime && canonicalResult.sourceFingerprint === sourceFingerprint
    ? canonicalResult.states : [];
  const syncReady = Boolean(runtime) && sourceProjection.sources.length > 0 &&
    canonicalResult.runtime === runtime && canonicalResult.sourceFingerprint === sourceFingerprint;
  const [pendingStates, setPendingStates] = useState<ReadonlyMap<string, ChatReactionObservation>>(
    () => new Map()
  );
  const [syncError, setSyncError] = useState<string | null>(sourceProjection.error);
  const syncRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    setCanonicalResult({ runtime: null, sourceFingerprint: '', states: [] });
    setPendingStates(new Map());
    setSyncError(sourceProjection.error);
  }, [runtime, sourceProjection.error]);

  useEffect(() => {
    if (!runtime || sourceProjection.error || deferSync || sourceProjection.sources.length === 0) {
      syncRef.current = null;
      return;
    }
    let disposed = false;
    const isCurrent = () => !disposed && viewRef.current.runtime === runtime &&
      viewRef.current.sourceFingerprint === sourceFingerprint && !viewRef.current.deferSync;
    let syncing = false;
    let queued = false;
    const sync = async (): Promise<void> => {
      if (!isCurrent()) return;
      if (syncing) {
        queued = true;
        return;
      }
      syncing = true;
      try {
        const result = await runtime.sync(sourcesRef.current, isCurrent);
        if (!isCurrent()) return;
        setCanonicalResult({ runtime, sourceFingerprint, states: result.states });
        setPendingStates((previous) => retainPendingChatReactionStates({
          pendingStates: previous,
          finalizedSources: sourcesRef.current,
          safeHeadBlock: result.safeHeadBlock
        }));
        setSyncError(null);
      } catch {
        if (isCurrent()) setSyncError('Reactions will retry after the next finalized block.');
      } finally {
        syncing = false;
        if (queued && isCurrent()) {
          queued = false;
          void sync();
        }
      }
    };
    syncRef.current = sync;
    void sync();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void sync();
    }, REACTION_SYNC_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      disposed = true;
      syncRef.current = null;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [runtime, sourceFingerprint, sourceProjection.error, sourceProjection.sources.length, deferSync]);

  const submitReaction = useCallback(async (input: Readonly<{
    source: ChatReactionSource;
    emoji: string;
    active: boolean;
    operationId: string;
  }>): Promise<ChatReactionWriteResult> => {
    if (!runtime || !syncReady || sourceProjection.error || syncError ||
        viewRef.current.runtime !== runtime || viewRef.current.sourceFingerprint !== sourceFingerprint ||
        viewRef.current.deferSync) {
      throw new Error(
        sourceProjection.error ?? syncError ?? 'Chat reactions are not active for this deployment.'
      );
    }
    const result = await runtime.setReaction(input);
    setPendingStates((previous) => {
      const next = new Map(previous);
      next.set(result.event.stateKey, result.event);
      return next;
    });
    void syncRef.current?.();
    return result;
  }, [runtime, sourceFingerprint, syncReady, sourceProjection.error, syncError]);

  const states = useMemo(() => {
    if (pendingStates.size === 0) return canonicalStates;
    const merged = new Map(canonicalStates.map((state) => [state.stateKey, state]));
    for (const pending of pendingStates.values()) merged.set(pending.stateKey, pending);
    return Object.freeze([...merged.values()].sort(compareChatReactionObservationOrder));
  }, [canonicalStates, pendingStates]);

  return {
    enabled: syncReady && !deferSync && !sourceProjection.error && !syncError,
    sources: sourceProjection.sources,
    states,
    submitReaction,
    syncError
  };
}
