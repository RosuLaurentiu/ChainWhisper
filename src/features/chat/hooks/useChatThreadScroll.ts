import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject
} from 'react';
import {
  INITIAL_VISIBLE_THREAD_MESSAGE_COUNT,
  VISIBLE_THREAD_MESSAGE_CHUNK
} from '../../../app/appHelpers';
import {
  messageReferencesMatch,
  parseSharedTxReference
} from '../../../lib/appHelpers';
import {
  getMessageDisplayText,
  shortenAddress,
  trimReplyPreview,
  type ChatMessage
} from '../../../lib/appShared';

type StateUpdate<T> = T | ((previous: T) => T);

type UseChatThreadScrollArgs = {
  activeContact: string | null;
  activeGroupId: number | null;
  activeMessages: ChatMessage[];
  activeGroupMessages: ChatMessage[];
  activeThreadKey: string | null;
  activeThreadMessages: ChatMessage[];
  activeThreadLastMessageId: string | null;
  isConnected: boolean;
  walletAddress: string;
  hasAesReady: boolean;
  loadOlderMessagesForActiveContact: () => Promise<void>;
  setHighlightedMessageId: (next: StateUpdate<string | null>) => void;
};

const isNearBottom = (container: HTMLDivElement): boolean =>
  container.scrollHeight - (container.scrollTop + container.clientHeight) <= 140;

export default function useChatThreadScroll({
  activeContact,
  activeGroupId,
  activeMessages,
  activeGroupMessages,
  activeThreadKey,
  activeThreadMessages,
  activeThreadLastMessageId,
  isConnected,
  walletAddress,
  hasAesReady,
  loadOlderMessagesForActiveContact,
  setHighlightedMessageId
}: UseChatThreadScrollArgs) {
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const messageElementRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const highlightTimeoutRef = useRef<number | null>(null);
  const pendingJumpTargetIdRef = useRef<string | null>(null);
  const pendingForcedBottomAnchorThreadKeyRef = useRef<string | null>(null);
  const suppressNextBottomAnchorRef = useRef(false);
  const previousThreadMetricsRef = useRef<{ key: string | null; length: number; lastMessageId: string | null }>({
    key: null,
    length: 0,
    lastMessageId: null
  });
  const previousActiveContactForScrollRef = useRef<string | null>(null);
  const previousLastMessageIdForScrollRef = useRef<string | null>(null);
  const previousThreadMessageCountForScrollRef = useRef(0);
  const previousVisibleThreadMessageCountForScrollRef = useRef(0);
  const lastObservedScrollHeightRef = useRef<number>(0);
  const stickToBottomRef = useRef(true);
  const [visibleThreadMessageCount, setVisibleThreadMessageCount] = useState(0);
  const [chatMessagesViewportVersion, setChatMessagesViewportVersion] = useState(0);

  const setChatMessagesContainerRef = useCallback((node: HTMLDivElement | null) => {
    const previousNode = chatMessagesRef.current;
    chatMessagesRef.current = node;
    if (node && previousNode !== node) {
      setChatMessagesViewportVersion((current) => current + 1);
    }
  }, []);

  const scrollChatToBottom = useCallback(() => {
    const container = chatMessagesRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, []);

  useEffect(() => {
    const previousThread = previousThreadMetricsRef.current;
    const nextThreadKey = activeThreadKey;
    const nextThreadLength = activeThreadMessages.length;
    const nextThreadLastMessageId = activeThreadLastMessageId;

    setVisibleThreadMessageCount((current) => {
      if (!nextThreadKey) {
        return 0;
      }
      if (previousThread.key !== nextThreadKey) {
        messageElementRefs.current = {};
        pendingJumpTargetIdRef.current = null;
        pendingForcedBottomAnchorThreadKeyRef.current = nextThreadKey;
        return Math.min(nextThreadLength, INITIAL_VISIBLE_THREAD_MESSAGE_COUNT);
      }

      if (nextThreadLength <= current) {
        return nextThreadLength;
      }

      const latestMessageChanged = previousThread.lastMessageId !== nextThreadLastMessageId;
      if (!latestMessageChanged) {
        if (current < INITIAL_VISIBLE_THREAD_MESSAGE_COUNT) {
          return Math.min(nextThreadLength, INITIAL_VISIBLE_THREAD_MESSAGE_COUNT);
        }
        return current;
      }

      if (
        current < INITIAL_VISIBLE_THREAD_MESSAGE_COUNT &&
        previousThread.length <= INITIAL_VISIBLE_THREAD_MESSAGE_COUNT
      ) {
        return Math.min(nextThreadLength, INITIAL_VISIBLE_THREAD_MESSAGE_COUNT);
      }

      return Math.min(current, nextThreadLength);
    });

    previousThreadMetricsRef.current = {
      key: nextThreadKey,
      length: nextThreadLength,
      lastMessageId: nextThreadLastMessageId
    };
  }, [activeThreadKey, activeThreadMessages.length, activeThreadLastMessageId]);

  const visibleActiveMessages = useMemo(() => {
    if (activeMessages.length <= visibleThreadMessageCount) {
      return activeMessages;
    }
    return activeMessages.slice(-visibleThreadMessageCount);
  }, [activeMessages, visibleThreadMessageCount]);

  const visibleActiveGroupMessages = useMemo(() => {
    if (activeGroupMessages.length <= visibleThreadMessageCount) {
      return activeGroupMessages;
    }
    return activeGroupMessages.slice(-visibleThreadMessageCount);
  }, [activeGroupMessages, visibleThreadMessageCount]);

  const highlightMessage = useCallback(
    (targetId: string) => {
      setHighlightedMessageId(targetId);

      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }

      highlightTimeoutRef.current = window.setTimeout(() => {
        setHighlightedMessageId((previous) => (previous === targetId ? null : previous));
        highlightTimeoutRef.current = null;
      }, 1800);
    },
    [setHighlightedMessageId]
  );

  const jumpToReferencedMessage = useCallback(
    (
      replyToMessageId?: string,
      replyToText?: string,
      replyToTxHash?: string,
      replyToBlockNumber?: number,
      replyToLogIndex?: number
    ) => {
      const referencePool = activeGroupId !== null ? activeGroupMessages : activeMessages;
      if (referencePool.length === 0) {
        return;
      }

      let targetId = replyToMessageId;
      if (!targetId) {
        const matchedByReference = referencePool.find((message) =>
          messageReferencesMatch(
            {
              txHash: message.txHash,
              blockNumber: message.blockNumber,
              logIndex: message.logIndex
            },
            {
              txHash: replyToTxHash,
              blockNumber: replyToBlockNumber,
              logIndex: replyToLogIndex
            }
          )
        );
        targetId = matchedByReference?.id;
      }

      if (!targetId && replyToText) {
        const targetPreview = trimReplyPreview(replyToText);
        const matched = referencePool.find(
          (message) => trimReplyPreview(getMessageDisplayText(message.text)) === targetPreview
        );
        targetId = matched?.id;
      }

      if (!targetId) {
        return;
      }

      const targetElement = messageElementRefs.current[targetId];
      if (!targetElement) {
        const targetIndex = referencePool.findIndex((message) => message.id === targetId);
        if (targetIndex >= 0) {
          pendingJumpTargetIdRef.current = targetId;
          setVisibleThreadMessageCount((current) =>
            Math.max(current, referencePool.length - targetIndex + 12)
          );
        }
        return;
      }

      targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      highlightMessage(targetId);
    },
    [activeGroupId, activeGroupMessages, activeMessages, highlightMessage]
  );

  const getReplyReferenceFallbackLabel = useCallback((message: ChatMessage): string => {
    if (message.replyToText) {
      return message.replyToText;
    }

    if (typeof message.replyToBlockNumber === 'number' && typeof message.replyToLogIndex === 'number') {
      return `Ref ${message.replyToBlockNumber.toString(36)}:${message.replyToLogIndex.toString(36)}`;
    }

    const sharedReference = parseSharedTxReference(message.replyToTxHash);
    if (sharedReference) {
      return `Ref ${sharedReference.blockNumber.toString(36)}:${sharedReference.txHashPrefix.slice(0, 6)}`;
    }

    if (message.replyToTxHash) {
      return `Tx ${shortenAddress(message.replyToTxHash)}`;
    }

    return 'Reply';
  }, []);

  useEffect(() => {
    const targetId = pendingJumpTargetIdRef.current;
    if (!targetId) {
      return;
    }

    const targetElement = messageElementRefs.current[targetId];
    if (!targetElement) {
      return;
    }

    pendingJumpTargetIdRef.current = null;
    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightMessage(targetId);
  }, [activeThreadKey, highlightMessage, visibleThreadMessageCount]);

  useEffect(() => {
    if (!isConnected || !activeThreadKey) {
      return;
    }

    const container = chatMessagesRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      stickToBottomRef.current = isNearBottom(container);
      if (container.scrollTop > 120) {
        return;
      }

      if (visibleThreadMessageCount < activeThreadMessages.length) {
        setVisibleThreadMessageCount((current) => {
          const next = Math.min(activeThreadMessages.length, current + VISIBLE_THREAD_MESSAGE_CHUNK);
          if (next > current) {
            suppressNextBottomAnchorRef.current = true;
          }
          return next;
        });
        return;
      }

      if (activeContact) {
        loadOlderMessagesForActiveContact().catch(() => {});
      }
    };

    stickToBottomRef.current = isNearBottom(container);
    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [
    isConnected,
    activeThreadKey,
    activeContact,
    walletAddress,
    hasAesReady,
    activeThreadMessages.length,
    visibleThreadMessageCount,
    chatMessagesViewportVersion,
    loadOlderMessagesForActiveContact
  ]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const activeContactChanged = previousActiveContactForScrollRef.current !== activeThreadKey;
    const currentMessageCount = activeThreadMessages.length;
    const currentLastMessageId = currentMessageCount > 0 ? activeThreadMessages[currentMessageCount - 1].id : null;
    const latestMessageChanged = previousLastMessageIdForScrollRef.current !== currentLastMessageId;
    const threadMessageCountChanged = previousThreadMessageCountForScrollRef.current !== currentMessageCount;
    const visibleThreadMessageCountChanged =
      previousVisibleThreadMessageCountForScrollRef.current !== visibleThreadMessageCount;
    const forceBottomAnchor = pendingForcedBottomAnchorThreadKeyRef.current === activeThreadKey;
    if (activeContactChanged) {
      stickToBottomRef.current = true;
      previousActiveContactForScrollRef.current = activeThreadKey;
      if (
        pendingForcedBottomAnchorThreadKeyRef.current &&
        pendingForcedBottomAnchorThreadKeyRef.current !== activeThreadKey
      ) {
        pendingForcedBottomAnchorThreadKeyRef.current = null;
      }
    }
    previousLastMessageIdForScrollRef.current = currentLastMessageId;
    previousThreadMessageCountForScrollRef.current = currentMessageCount;
    previousVisibleThreadMessageCountForScrollRef.current = visibleThreadMessageCount;

    if (
      suppressNextBottomAnchorRef.current &&
      visibleThreadMessageCountChanged &&
      !forceBottomAnchor &&
      !activeContactChanged &&
      !latestMessageChanged &&
      !threadMessageCountChanged
    ) {
      suppressNextBottomAnchorRef.current = false;
      return;
    }
    suppressNextBottomAnchorRef.current = false;

    if (
      !forceBottomAnchor &&
      !activeContactChanged &&
      ((!latestMessageChanged && !threadMessageCountChanged && !visibleThreadMessageCountChanged) ||
        !stickToBottomRef.current)
    ) {
      return;
    }

    let cancelled = false;

    const scrollToBottomAfterLayout = () => {
      if (cancelled) {
        return;
      }

      pendingForcedBottomAnchorThreadKeyRef.current = null;
      scrollChatToBottom();
      window.setTimeout(() => {
        if (!cancelled) {
          scrollChatToBottom();
        }
      }, 0);
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(scrollToBottomAfterLayout);
    });

    return () => {
      cancelled = true;
    };
  }, [activeThreadKey, activeThreadMessages, visibleThreadMessageCount, chatMessagesViewportVersion, scrollChatToBottom]);

  useEffect(() => {
    const container = chatMessagesRef.current;
    if (!container) {
      return;
    }

    const handleImageLoad = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target || target.tagName !== 'IMG') {
        return;
      }

      const lastMessage = activeThreadMessages.length > 0 ? activeThreadMessages[activeThreadMessages.length - 1] : null;
      const lastMessageElement = lastMessage ? messageElementRefs.current[lastMessage.id] : null;
      const imageInLatestMessage = Boolean(lastMessageElement && target && lastMessageElement.contains(target));
      if (!stickToBottomRef.current && !imageInLatestMessage) {
        return;
      }

      requestAnimationFrame(() => {
        scrollChatToBottom();
        window.setTimeout(() => {
          scrollChatToBottom();
        }, 0);
      });
    };

    container.addEventListener('load', handleImageLoad, true);
    return () => {
      container.removeEventListener('load', handleImageLoad, true);
    };
  }, [activeThreadKey, activeThreadMessages, chatMessagesViewportVersion, scrollChatToBottom]);

  useEffect(() => {
    const container = chatMessagesRef.current;
    if (!container || typeof ResizeObserver === 'undefined') {
      return;
    }

    lastObservedScrollHeightRef.current = container.scrollHeight;
    const observer = new ResizeObserver(() => {
      const nextHeight = container.scrollHeight;
      if (nextHeight === lastObservedScrollHeightRef.current) {
        return;
      }

      lastObservedScrollHeightRef.current = nextHeight;
      if (!stickToBottomRef.current) {
        return;
      }

      requestAnimationFrame(() => {
        scrollChatToBottom();
        window.setTimeout(() => {
          scrollChatToBottom();
        }, 0);
      });
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [activeThreadKey, chatMessagesViewportVersion, scrollChatToBottom]);

  useEffect(() => {
    if (!isConnected || !activeThreadKey) {
      return;
    }

    stickToBottomRef.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollChatToBottom();
      });
    });
  }, [isConnected, activeThreadKey, chatMessagesViewportVersion, scrollChatToBottom]);

  const resetThreadScrollState = useCallback(() => {
    stickToBottomRef.current = true;
    previousActiveContactForScrollRef.current = null;
    previousLastMessageIdForScrollRef.current = null;
    previousThreadMessageCountForScrollRef.current = 0;
    previousVisibleThreadMessageCountForScrollRef.current = 0;
    pendingForcedBottomAnchorThreadKeyRef.current = null;
    suppressNextBottomAnchorRef.current = false;
  }, []);

  return {
    chatMessagesRef: setChatMessagesContainerRef,
    getReplyReferenceFallbackLabel,
    jumpToReferencedMessage,
    messageElementRefs: messageElementRefs as MutableRefObject<Record<string, HTMLDivElement | null>>,
    pendingForcedBottomAnchorThreadKeyRef,
    resetThreadScrollState,
    stickToBottomRef,
    visibleActiveGroupMessages,
    visibleActiveMessages
  };
}
