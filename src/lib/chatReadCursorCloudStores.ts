import {
  reconcileDirectChatReadCursorCloud,
  reconcileGroupChatReadCursorCloud,
  resetDirectChatReadCursorCloud
} from './chatReadCursorCloud';
import type { ChatReadCursorCloudSession } from './chatReadCursorCloudAuth';
import {
  createDirectChatV2ReadCursorStore,
  type DirectChatV2ReadCursorCanonicalContext,
  type DirectChatV2ReadCursorStore
} from './directChatV2ReadCursorStore';
import {
  createGroupChatV2ReadCursorStore,
  type GroupChatV2ReadCursorStore
} from './groupChatV2ReadCursorStore';

type CloudErrorHandler = (error: unknown) => void;

/**
 * Adds best-effort authenticated cloud convergence without weakening the local
 * canonical store. Supabase outages never block local unread state or chat.
 */
export const createCloudSyncedDirectChatV2ReadCursorStore = ({
  local = createDirectChatV2ReadCursorStore(),
  onCloudError,
  reconcileCloud = reconcileDirectChatReadCursorCloud,
  resetCloud = resetDirectChatReadCursorCloud,
  session
}: {
  local?: DirectChatV2ReadCursorStore;
  onCloudError?: CloudErrorHandler;
  reconcileCloud?: typeof reconcileDirectChatReadCursorCloud;
  resetCloud?: typeof resetDirectChatReadCursorCloud;
  session: ChatReadCursorCloudSession;
}): DirectChatV2ReadCursorStore => {
  let closed = false;
  const reconcile = async ({
    canonicalMessageCount,
    cursor,
    readCanonicalMessageAnchor,
    scope
  }: {
    canonicalMessageCount: bigint;
    cursor: Awaited<ReturnType<DirectChatV2ReadCursorStore['loadCanonical']>>;
    readCanonicalMessageAnchor: DirectChatV2ReadCursorCanonicalContext['readCanonicalMessageAnchor'];
    scope: Parameters<DirectChatV2ReadCursorStore['loadCanonical']>[0]['scope'];
  }) => {
    if (closed) return cursor;
    try {
      const cloud = await reconcileCloud({
        canonicalMessageCount,
        localCursor: cursor,
        readCanonicalMessageAnchor,
        scope,
        session
      });
      if (closed) return cursor;
      return await local.mergeAndPersist({
        scope,
        candidates: [cloud],
        canonicalMessageCount,
        readCanonicalMessageAnchor
      });
    } catch (error) {
      onCloudError?.(error);
      return cursor;
    }
  };

  return Object.freeze({
    get coordination() { return local.coordination; },
    get durability() { return local.durability; },
    loadCanonical: async (input) => reconcile({
      ...input,
      cursor: await local.loadCanonical(input)
    }),
    mergeAndPersist: async (input) => reconcile({
      ...input,
      cursor: await local.mergeAndPersist(input)
    }),
    advanceVisibleAndPersist: async (input) => reconcile({
      ...input,
      cursor: await local.advanceVisibleAndPersist(input)
    }),
    reset: async (scope) => {
      const cursor = await local.reset(scope);
      if (!closed) {
        try {
          await resetCloud({ scope, session });
        } catch (error) {
          onCloudError?.(error);
        }
      }
      return cursor;
    },
    subscribe: (input) => local.subscribe(input),
    close: () => {
      if (closed) return;
      closed = true;
      local.close();
    }
  });
};

export const createCloudSyncedGroupChatV2ReadCursorStore = ({
  local = createGroupChatV2ReadCursorStore(),
  onCloudError,
  reconcileCloud = reconcileGroupChatReadCursorCloud,
  session
}: {
  local?: GroupChatV2ReadCursorStore;
  onCloudError?: CloudErrorHandler;
  reconcileCloud?: typeof reconcileGroupChatReadCursorCloud;
  session: ChatReadCursorCloudSession;
}): GroupChatV2ReadCursorStore => {
  let closed = false;
  const reconcile = async <T extends Awaited<ReturnType<GroupChatV2ReadCursorStore['loadCanonical']>>>(
    scope: Parameters<GroupChatV2ReadCursorStore['loadCanonical']>[0],
    context: Parameters<GroupChatV2ReadCursorStore['loadCanonical']>[1],
    cursor: T
  ): Promise<T> => {
    if (closed) return cursor;
    try {
      const cloud = await reconcileCloud({
        getCanonicalMessageCount: context.getCanonicalMessageCount,
        localCursor: cursor,
        readCanonicalAnchor: context.readCanonicalAnchor,
        scope,
        session
      });
      if (closed) return cursor;
      return await local.mergeCanonical(scope, [cloud], context) as T;
    } catch (error) {
      onCloudError?.(error);
      return cursor;
    }
  };

  return Object.freeze({
    get coordination() { return local.coordination; },
    loadCanonical: async (scope, context) => reconcile(
      scope,
      context,
      await local.loadCanonical(scope, context)
    ),
    mergeCanonical: async (scope, candidates, context) => reconcile(
      scope,
      context,
      await local.mergeCanonical(scope, candidates, context)
    ),
    advanceVisible: async (scope, message, context) => reconcile(
      scope,
      context,
      await local.advanceVisible(scope, message, context)
    ),
    reset: async (scope) => {
      const cursor = await local.reset(scope);
      // Reconcile on the next canonical load. It persists the empty generation
      // before any later visible message in that generation.
      return cursor;
    },
    subscribe: (scope, context, onCursor, onError) => local.subscribe(
      scope,
      context,
      onCursor,
      onError
    ),
    close: () => {
      if (closed) return;
      closed = true;
      local.close();
    }
  });
};
