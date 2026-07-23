import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TRADE_AGENT_QUICK_ACTIONS,
  consumeTradeAgentDraft,
  fetchTradeAgentFeeEstimate,
  type TradeAgentActionType,
  type TradeAgentQuickAction,
  type TradeAgentFeeQuote
} from '../../../lib/tradeAgent';
import { readTradeAgentPaymentRetry } from '../../../lib/tradeAgentPayment';
import { formatTradeAgentFeeLabel } from '../../../app/appHelpers';
import type { OtcSwapInputMode } from '../../../lib/otcSwapQuote';
import { type TradeAgentChatMessage } from '../components/P2PTradingPage.helpers';

const TRADE_AGENT_FEE_DISPLAY_CACHE_KEY = 'chainwhisper:trade-agent-fee-display:v1';
const TRADE_AGENT_FEE_DISPLAY_CACHE_MAX_AGE_MS = 30 * 60 * 1_000;

const readCachedTradeAgentFeeLabel = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }
  try {
    const cached = JSON.parse(
      window.localStorage.getItem(TRADE_AGENT_FEE_DISPLAY_CACHE_KEY) ?? 'null'
    ) as { cachedAt?: unknown; label?: unknown } | null;
    if (
      !cached ||
      typeof cached.cachedAt !== 'number' ||
      Date.now() - cached.cachedAt > TRADE_AGENT_FEE_DISPLAY_CACHE_MAX_AGE_MS ||
      typeof cached.label !== 'string' ||
      !/^[1-9]\d* WISP$/u.test(cached.label)
    ) {
      return '';
    }
    return cached.label;
  } catch {
    return '';
  }
};

const cacheTradeAgentFeeLabel = (label: string): void => {
  if (typeof window === 'undefined' || !/^[1-9]\d* WISP$/u.test(label)) {
    return;
  }
  try {
    window.localStorage.setItem(
      TRADE_AGENT_FEE_DISPLAY_CACHE_KEY,
      JSON.stringify({ cachedAt: Date.now(), label })
    );
  } catch {
    // The live estimate remains available even when browser storage is unavailable.
  }
};

type UseP2PTradeAgentSessionArgs = {
  hasDetailTrade: boolean;
  hasReviewOrders: boolean;
  routeSurfaceView: string | null;
  swapActionMode: OtcSwapInputMode;
  swapBuyTokenSymbol?: string;
  swapSellTokenSymbol?: string;
};

export const shouldLoadTradeAgentFeeEstimate = (
  routeSurfaceView: string | null,
  panelMode: 'help' | 'trade'
): boolean => routeSurfaceView === 'agent' && panelMode === 'trade';

export default function useP2PTradeAgentSession({
  hasDetailTrade,
  hasReviewOrders,
  routeSurfaceView,
  swapActionMode,
  swapBuyTokenSymbol,
  swapSellTokenSymbol
}: UseP2PTradeAgentSessionArgs) {
  const [initialTradeAgentRetryPayment] = useState(() => {
    const retry = readTradeAgentPaymentRetry();
    return retry?.context.clientSurface === 'otc-agent' ? retry : null;
  });
  const [tradeAgentPanelMode, setTradeAgentPanelMode] = useState<'help' | 'trade'>('help');
  const [tradeAgentAction, setTradeAgentAction] = useState<TradeAgentActionType>(
    () => initialTradeAgentRetryPayment?.action ?? 'find_price'
  );
  const [tradeAgentPrompt, setTradeAgentPrompt] = useState(() => initialTradeAgentRetryPayment?.prompt ?? '');
  const [tradeAgentMessages, setTradeAgentMessages] = useState<TradeAgentChatMessage[]>([
    {
      id: 'intro',
      role: 'assistant',
      title: 'Trade Agent',
      text: 'Compare price references, explain or review orders, and draft limit, recurring, counter, or chat-based trades. Every result is editable and you still confirm every action.'
    }
  ]);
  const [tradeAgentFeeQuote, setTradeAgentFeeQuote] = useState<TradeAgentFeeQuote | null>(null);
  const [cachedTradeAgentFeeLabel, setCachedTradeAgentFeeLabel] = useState(
    readCachedTradeAgentFeeLabel
  );
  const [tradeAgentExplicitContext, setTradeAgentExplicitContext] = useState<unknown | null>(
    () => initialTradeAgentRetryPayment?.context ?? null
  );
  const [tradeAgentError, setTradeAgentError] = useState('');
  const [tradeAgentRetryPaymentTxHash, setTradeAgentRetryPaymentTxHash] = useState(
    () => initialTradeAgentRetryPayment?.paymentTxHash ?? ''
  );
  const [tradeAgentRetryPaymentRequestId, setTradeAgentRetryPaymentRequestId] = useState(
    () => initialTradeAgentRetryPayment?.requestId ?? ''
  );
  const [tradeAgentStatus, setTradeAgentStatus] = useState(() =>
    initialTradeAgentRetryPayment ? 'You can retry without paying again.' : ''
  );
  const [tradeAgentLoading, setTradeAgentLoading] = useState(false);
  const [tradeAgentFeeLoading, setTradeAgentFeeLoading] = useState(false);
  const tradeAgentMessageCounterRef = useRef(0);
  const tradeAgentMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollTradeAgentRef = useRef(true);

  const tradeAgentFeeLabel = useMemo(() => {
    if (tradeAgentFeeQuote) {
      try {
        return `Est. ${formatTradeAgentFeeLabel(tradeAgentFeeQuote)} / request`;
      } catch {
        // Fall through to the last short-lived display estimate.
      }
    }
    if (cachedTradeAgentFeeLabel) {
      return `Est. ${cachedTradeAgentFeeLabel} / request`;
    }
    return tradeAgentFeeLoading ? 'Checking WISP cost...' : 'WISP cost temporarily unavailable';
  }, [cachedTradeAgentFeeLabel, tradeAgentFeeLoading, tradeAgentFeeQuote]);

  useEffect(() => {
    if (!tradeAgentFeeQuote) {
      return;
    }
    try {
      const label = formatTradeAgentFeeLabel(tradeAgentFeeQuote);
      setCachedTradeAgentFeeLabel(label);
      cacheTradeAgentFeeLabel(label);
    } catch {
      // Invalid display data is ignored; the signed final quote is validated separately.
    }
  }, [tradeAgentFeeQuote]);

  const appendTradeAgentMessage = useCallback((message: Omit<TradeAgentChatMessage, 'id'>) => {
    const messagesContainer = tradeAgentMessagesEndRef.current?.parentElement;
    const distanceFromBottom = messagesContainer
      ? messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight
      : 0;
    shouldAutoScrollTradeAgentRef.current = message.role === 'user' || distanceFromBottom <= 80;
    tradeAgentMessageCounterRef.current += 1;
    const id = `agent:${Date.now()}:${tradeAgentMessageCounterRef.current}`;
    setTradeAgentMessages((current) => [...current, { ...message, id }]);
  }, []);

  const appendTradeAgentStatusMessage = useCallback(
    (text: string) => {
      appendTradeAgentMessage({
        role: 'status',
        title: 'Update',
        text
      });
    },
    [appendTradeAgentMessage]
  );

  useEffect(() => {
    if (routeSurfaceView !== 'agent' || !shouldAutoScrollTradeAgentRef.current) {
      return;
    }
    const messagesContainer = tradeAgentMessagesEndRef.current?.parentElement;
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }, [routeSurfaceView, tradeAgentLoading, tradeAgentMessages, tradeAgentStatus]);

  useEffect(() => {
    if (routeSurfaceView !== 'agent') {
      return;
    }
    const draft = consumeTradeAgentDraft();
    if (!draft) {
      return;
    }
    setTradeAgentAction(draft.action);
    setTradeAgentPrompt(draft.prompt);
    setTradeAgentExplicitContext(draft.context ?? null);
    setTradeAgentPanelMode('trade');
    setTradeAgentStatus('Draft loaded from chat.');
    appendTradeAgentStatusMessage('Draft loaded from chat.');
  }, [appendTradeAgentStatusMessage, routeSurfaceView]);

  useEffect(() => {
    if (!shouldLoadTradeAgentFeeEstimate(routeSurfaceView, tradeAgentPanelMode)) {
      return;
    }
    let cancelled = false;
    let retryTimeoutId: ReturnType<typeof setTimeout> | undefined;
    setTradeAgentFeeLoading(true);
    const loadEstimate = (attempt: number) => {
      fetchTradeAgentFeeEstimate(tradeAgentAction)
        .then((quote) => {
          if (!cancelled) {
            setTradeAgentFeeQuote(quote);
            setTradeAgentFeeLoading(false);
          }
        })
        .catch(() => {
          if (cancelled) {
            return;
          }
          if (attempt === 0) {
            retryTimeoutId = setTimeout(() => loadEstimate(1), 1_500);
            return;
          }
          setTradeAgentFeeLoading(false);
        });
    };
    loadEstimate(0);
    return () => {
      cancelled = true;
      if (retryTimeoutId !== undefined) {
        clearTimeout(retryTimeoutId);
      }
    };
  }, [routeSurfaceView, tradeAgentAction, tradeAgentPanelMode]);

  const visibleTradeAgentQuickActions = useMemo(
    () => TRADE_AGENT_QUICK_ACTIONS.filter((item) => {
      if (item.contextRequirement === 'order') {
        return Boolean(tradeAgentExplicitContext || hasDetailTrade);
      }
      if (item.contextRequirement === 'orders') {
        return hasReviewOrders;
      }
      return true;
    }),
    [hasDetailTrade, hasReviewOrders, tradeAgentExplicitContext]
  );

  const updateTradeAgentPrompt = useCallback((value: string) => {
    if (tradeAgentRetryPaymentTxHash) {
      setTradeAgentRetryPaymentTxHash('');
      setTradeAgentRetryPaymentRequestId('');
      setTradeAgentStatus('');
    }
    setTradeAgentPrompt(value);
  }, [tradeAgentRetryPaymentTxHash]);

  const resolveTradeAgentQuickActionPrompt = useCallback(
    (item: TradeAgentQuickAction): string => {
      if (!swapSellTokenSymbol || !swapBuyTokenSymbol) {
        return item.prompt;
      }
      if (item.action === 'find_price') {
        return `Compare current price references for ${swapSellTokenSymbol} and ${swapBuyTokenSymbol} for a ${swapActionMode} request. Keep reference-only venues separate and do not require an amount.`;
      }
      if (item.action === 'draft_limit') {
        return `Help me draft a limit order for ${swapSellTokenSymbol} and ${swapBuyTokenSymbol}. Ask for any missing side, amount, price, access, or amount-visibility details.`;
      }
      if (item.action === 'draft_recurring') {
        return `Help me draft a recurring order for ${swapSellTokenSymbol} / ${swapBuyTokenSymbol}. Ask for any missing prices, liquidity, or amount-visibility details.`;
      }
      return item.prompt;
    },
    [swapActionMode, swapBuyTokenSymbol, swapSellTokenSymbol]
  );

  const selectTradeAgentQuickAction = useCallback((item: TradeAgentQuickAction, prompt: string) => {
    setTradeAgentAction(item.action);
    setTradeAgentRetryPaymentTxHash('');
    setTradeAgentRetryPaymentRequestId('');
    setTradeAgentStatus('');
    setTradeAgentError('');
    setTradeAgentPrompt(prompt);
  }, []);

  return {
    appendTradeAgentMessage,
    appendTradeAgentStatusMessage,
    selectTradeAgentQuickAction,
    resolveTradeAgentQuickActionPrompt,
    setTradeAgentAction,
    setTradeAgentError,
    setTradeAgentExplicitContext,
    setTradeAgentFeeQuote,
    setTradeAgentLoading,
    setTradeAgentPanelMode,
    setTradeAgentPrompt,
    setTradeAgentRetryPaymentRequestId,
    setTradeAgentRetryPaymentTxHash,
    setTradeAgentStatus,
    tradeAgentAction,
    tradeAgentError,
    tradeAgentExplicitContext,
    tradeAgentFeeLabel,
    tradeAgentFeeLoading,
    tradeAgentLoading,
    tradeAgentMessages,
    tradeAgentMessagesEndRef,
    tradeAgentPanelMode,
    tradeAgentPrompt,
    tradeAgentRetryPaymentRequestId,
    tradeAgentRetryPaymentTxHash,
    tradeAgentStatus,
    updateTradeAgentPrompt,
    visibleTradeAgentQuickActions
  };
}
