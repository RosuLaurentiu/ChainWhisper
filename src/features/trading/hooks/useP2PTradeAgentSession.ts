import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TRADE_AGENT_QUICK_ACTIONS,
  consumeTradeAgentDraft,
  fetchTradeAgentFeeQuote,
  type TradeAgentActionType,
  type TradeAgentQuickAction,
  type TradeAgentFeeQuote
} from '../../../lib/tradeAgent';
import { formatTokenAmount } from '../../../lib/appShared';
import type { OtcSwapInputMode } from '../../../lib/otcSwapQuote';
import {
  readTradeAgentRetryPayment,
  writeTradeAgentRetryPayment,
  type TradeAgentChatMessage
} from '../components/P2PTradingPage.helpers';

type UseP2PTradeAgentSessionArgs = {
  hasDetailTrade: boolean;
  routeSurfaceView: string | null;
  swapActionMode: OtcSwapInputMode;
  swapBuyTokenSymbol?: string;
  swapSellTokenSymbol?: string;
};

export default function useP2PTradeAgentSession({
  hasDetailTrade,
  routeSurfaceView,
  swapActionMode,
  swapBuyTokenSymbol,
  swapSellTokenSymbol
}: UseP2PTradeAgentSessionArgs) {
  const [initialTradeAgentRetryPayment] = useState(() => readTradeAgentRetryPayment());
  const [tradeAgentAction, setTradeAgentAction] = useState<TradeAgentActionType>(
    () => initialTradeAgentRetryPayment?.action ?? 'find_price'
  );
  const [tradeAgentPrompt, setTradeAgentPrompt] = useState(() => initialTradeAgentRetryPayment?.prompt ?? '');
  const [tradeAgentMessages, setTradeAgentMessages] = useState<TradeAgentChatMessage[]>([
    {
      id: 'intro',
      role: 'assistant',
      title: 'Trade Agent',
      text: 'Ask me to compare prices, find a ChainWhisper order, or turn text into a draft trade. You still confirm every action.'
    }
  ]);
  const [tradeAgentFeeQuote, setTradeAgentFeeQuote] = useState<TradeAgentFeeQuote | null>(null);
  const [tradeAgentExplicitContext, setTradeAgentExplicitContext] = useState<unknown | null>(null);
  const [tradeAgentError, setTradeAgentError] = useState('');
  const [tradeAgentRetryPaymentTxHash, setTradeAgentRetryPaymentTxHash] = useState(
    () => initialTradeAgentRetryPayment?.txHash ?? ''
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

  const tradeAgentFeeLabel = useMemo(() => {
    if (!tradeAgentFeeQuote) {
      return 'WISP per request';
    }
    try {
      return `${formatTokenAmount(BigInt(tradeAgentFeeQuote.feeAmountWei), tradeAgentFeeQuote.feeTokenDecimals, 4)} WISP per request`;
    } catch {
      return 'WISP per request';
    }
  }, [tradeAgentFeeQuote]);

  const appendTradeAgentMessage = useCallback((message: Omit<TradeAgentChatMessage, 'id'>) => {
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
    if (routeSurfaceView !== 'agent') {
      return;
    }
    tradeAgentMessagesEndRef.current?.scrollIntoView({ block: 'end' });
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
    setTradeAgentStatus('Draft loaded from chat.');
    appendTradeAgentStatusMessage('Draft loaded from chat.');
  }, [appendTradeAgentStatusMessage, routeSurfaceView]);

  useEffect(() => {
    if (routeSurfaceView !== 'agent') {
      return;
    }
    let cancelled = false;
    setTradeAgentFeeLoading(true);
    fetchTradeAgentFeeQuote(tradeAgentAction)
      .then((quote) => {
        if (!cancelled) {
          setTradeAgentFeeQuote(quote);
          setTradeAgentError('');
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setTradeAgentFeeQuote(null);
          setTradeAgentError(error instanceof Error ? error.message : 'Trade Agent fee quote is unavailable.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTradeAgentFeeLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [routeSurfaceView, tradeAgentAction]);

  const visibleTradeAgentQuickActions = useMemo(
    () => TRADE_AGENT_QUICK_ACTIONS.filter((item) => !item.requiresContext || tradeAgentExplicitContext || hasDetailTrade),
    [hasDetailTrade, tradeAgentExplicitContext]
  );

  const updateTradeAgentPrompt = useCallback((value: string) => {
    if (tradeAgentRetryPaymentTxHash) {
      setTradeAgentRetryPaymentTxHash('');
      setTradeAgentRetryPaymentRequestId('');
      writeTradeAgentRetryPayment(null);
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
        const request =
          swapActionMode === 'buy'
            ? `buy [amount] ${swapBuyTokenSymbol} with ${swapSellTokenSymbol}`
            : `sell [amount] ${swapSellTokenSymbol} for ${swapBuyTokenSymbol}`;
        return `I want to ${request}.`;
      }
      if (item.action === 'draft_limit') {
        return `I want to [buy/sell] [amount] ${swapSellTokenSymbol} for ${swapBuyTokenSymbol} at [price]. Order: [public/unlisted/direct]. Liquidity: [private/visible].`;
      }
      return item.prompt;
    },
    [swapActionMode, swapBuyTokenSymbol, swapSellTokenSymbol]
  );

  const selectTradeAgentQuickAction = useCallback((item: TradeAgentQuickAction, prompt: string) => {
    setTradeAgentAction(item.action);
    setTradeAgentRetryPaymentTxHash('');
    setTradeAgentRetryPaymentRequestId('');
    writeTradeAgentRetryPayment(null);
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
    setTradeAgentPrompt,
    setTradeAgentRetryPaymentRequestId,
    setTradeAgentRetryPaymentTxHash,
    setTradeAgentStatus,
    tradeAgentAction,
    tradeAgentError,
    tradeAgentExplicitContext,
    tradeAgentFeeLabel,
    tradeAgentFeeLoading,
    tradeAgentFeeQuote,
    tradeAgentLoading,
    tradeAgentMessages,
    tradeAgentMessagesEndRef,
    tradeAgentPrompt,
    tradeAgentRetryPaymentRequestId,
    tradeAgentRetryPaymentTxHash,
    tradeAgentStatus,
    updateTradeAgentPrompt,
    visibleTradeAgentQuickActions
  };
}
