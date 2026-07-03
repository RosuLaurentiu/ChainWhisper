import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import {
  buildP2PActionNotice,
  type P2PActionNotice,
  type P2PActionNoticeInput,
  type P2PActionNoticeSurface
} from '../../../lib/p2pActionNotice';
import { getOtcSwapAssetKey } from '../../../lib/otcSwapQuote';
import {
  clearPendingOtcSwapIntent,
  rememberOtcSwapFillNote,
  type OtcSwapFillNote,
  type OtcSwapIntent
} from '../../../lib/otcSwapIntent';
import { buildTransactionExplorerUrl } from '../../../lib/p2pTradeView';
import type { TradeActionConfirmModel } from '../../../lib/tradeActionConfirm';

type UseP2PActionFeedbackArgs = {
  activeTerminalSwapIntentRef: MutableRefObject<OtcSwapIntent | null>;
  setSwapFillNotes: Dispatch<SetStateAction<OtcSwapFillNote[]>>;
};

export default function useP2PActionFeedback({
  activeTerminalSwapIntentRef,
  setSwapFillNotes
}: UseP2PActionFeedbackArgs) {
  const [lastCopiedKey, setLastCopiedKey] = useState('');
  const [lastViewedTxKey, setLastViewedTxKey] = useState('');
  const [actionNotice, setActionNotice] = useState<P2PActionNotice | null>(null);
  const [tradeActionConfirmation, setTradeActionConfirmation] = useState<TradeActionConfirmModel | null>(null);
  const tradeActionConfirmationResolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const copyWithFeedback = useCallback(async (value: string, key: string) => {
    await navigator.clipboard.writeText(value);
    setLastCopiedKey(key);
    window.setTimeout(() => {
      setLastCopiedKey((current) => (current === key ? '' : current));
    }, 1400);
  }, []);

  const markTransactionViewed = useCallback((key: string) => {
    if (!key) {
      return;
    }
    setLastViewedTxKey(key);
    window.setTimeout(() => {
      setLastViewedTxKey((current) => (current === key ? '' : current));
    }, 1400);
  }, []);

  const clearActionNotice = useCallback(() => {
    setActionNotice(null);
  }, []);

  const getTransactionLinkFeedbackProps = useCallback(
    (
      key: string,
      options: {
        className?: string;
        defaultLabel?: string;
        openedLabel?: string;
        title?: string;
        openedTitle?: string;
      } = {}
    ) => {
      const viewed = Boolean(key && lastViewedTxKey === key);
      const defaultLabel = options.defaultLabel ?? 'View Tx';
      const openedLabel = options.openedLabel ?? 'Opened';
      return {
        className: [options.className, 'p2p-tx-feedback-link', viewed ? 'viewed' : '']
          .filter(Boolean)
          .join(' '),
        label: viewed ? openedLabel : defaultLabel,
        onClick: () => markTransactionViewed(key),
        title: viewed ? options.openedTitle ?? 'Transaction opened' : options.title ?? 'Open transaction on explorer'
      };
    },
    [lastViewedTxKey, markTransactionViewed]
  );

  const pushActionNotice = useCallback((notice: P2PActionNoticeInput) => {
    const intent = activeTerminalSwapIntentRef.current;
    const tradeKey = notice.tradeKey?.trim().toLowerCase() ?? '';
    const noticeMatchesSwapIntent = Boolean(intent && (!tradeKey || intent.tradeKey === tradeKey));
    if ((notice.action === 'fill' || notice.action === 'accept') && notice.status === 'success') {
      if (intent && (!tradeKey || intent.tradeKey === tradeKey)) {
        const requestedRole = intent.inputMode === 'sell' ? 'sold' : 'bought';
        const nextNotes = rememberOtcSwapFillNote({
          tradeKey: intent.tradeKey,
          txHash: notice.txHash,
          requestedAmountWei:
            requestedRole === 'sold' ? intent.requestedSellAmountWei : intent.requestedBuyAmountWei,
          requestedAssetKey: requestedRole === 'sold' ? intent.sellTokenKey : intent.buyTokenKey,
          requestedSymbol: requestedRole === 'sold' ? intent.sellTokenSymbol : intent.buyTokenSymbol,
          requestedDecimals: requestedRole === 'sold' ? intent.sellTokenDecimals : intent.buyTokenDecimals,
          requestedRole,
          privateLiquidity: intent.privateLiquidity,
          timestamp: Date.now()
        });
        setSwapFillNotes(nextNotes);
      } else if (tradeKey && notice.requestedFill) {
        const nextNotes = rememberOtcSwapFillNote({
          tradeKey,
          txHash: notice.txHash,
          requestedAmountWei: notice.requestedFill.amountWei,
          requestedAssetKey: getOtcSwapAssetKey(notice.requestedFill.asset),
          requestedSymbol: notice.requestedFill.asset.symbol,
          requestedDecimals: notice.requestedFill.asset.decimals,
          requestedRole: notice.requestedFill.role,
          privateLiquidity: notice.requestedFill.privateLiquidity,
          timestamp: Date.now()
        });
        setSwapFillNotes(nextNotes);
      }
    }
    if (
      noticeMatchesSwapIntent &&
      (notice.action === 'fill' || notice.action === 'accept') &&
      notice.status !== 'pending'
    ) {
      clearPendingOtcSwapIntent();
      activeTerminalSwapIntentRef.current = null;
    }
    setActionNotice(buildP2PActionNotice(notice));
  }, [activeTerminalSwapIntentRef, setSwapFillNotes]);

  const requestTradeActionConfirmation = useCallback((confirmation: TradeActionConfirmModel): Promise<boolean> => {
    tradeActionConfirmationResolveRef.current?.(false);
    setTradeActionConfirmation(confirmation);
    return new Promise((resolve) => {
      tradeActionConfirmationResolveRef.current = resolve;
    });
  }, []);

  const resolveTradeActionConfirmation = useCallback((confirmed: boolean) => {
    const resolve = tradeActionConfirmationResolveRef.current;
    tradeActionConfirmationResolveRef.current = null;
    setTradeActionConfirmation(null);
    resolve?.(confirmed);
  }, []);

  useEffect(
    () => () => {
      tradeActionConfirmationResolveRef.current?.(false);
      tradeActionConfirmationResolveRef.current = null;
    },
    []
  );

  useEffect(() => {
    if (!actionNotice || actionNotice.status === 'pending') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setActionNotice((current) => (current?.id === actionNotice.id ? null : current));
    }, 6500);

    return () => window.clearTimeout(timeoutId);
  }, [actionNotice]);

  const renderP2PActionNotice = useCallback(
    (surface: P2PActionNoticeSurface, tradeKey?: string) => {
      if (!actionNotice || actionNotice.surface !== surface) {
        return null;
      }
      if (tradeKey && actionNotice.tradeKey && actionNotice.tradeKey !== tradeKey) {
        return null;
      }

      const txUrl = buildTransactionExplorerUrl(actionNotice.txHash);
      const txLinkFeedback = txUrl
        ? getTransactionLinkFeedbackProps(`notice:${actionNotice.id}:${actionNotice.txHash}`, {
            title: 'Open action transaction on explorer'
          })
        : null;
      return (
        <div
          className={`p2p-action-notice p2p-action-notice-${actionNotice.status}`}
          role={actionNotice.status === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          <span className="p2p-action-notice-dot" aria-hidden="true" />
          <strong>{actionNotice.message}</strong>
          {txUrl && txLinkFeedback ? (
            <a
              className={txLinkFeedback.className}
              href={txUrl}
              target="_blank"
              rel="noreferrer"
              onClick={txLinkFeedback.onClick}
              title={txLinkFeedback.title}
            >
              {txLinkFeedback.label}
            </a>
          ) : null}
        </div>
      );
    },
    [actionNotice, getTransactionLinkFeedbackProps]
  );

  return {
    clearActionNotice,
    copyWithFeedback,
    getTransactionLinkFeedbackProps,
    lastCopiedKey,
    pushActionNotice,
    renderP2PActionNotice,
    requestTradeActionConfirmation,
    resolveTradeActionConfirmation,
    tradeActionConfirmation
  };
}
