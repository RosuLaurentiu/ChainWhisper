import { useCallback, useEffect, useRef, useState } from 'react';
import type { TradeActionConfirmModel } from '../../../lib/tradeActionConfirm';

export default function useTradeActionConfirmationState(scope?: object) {
  const [review, setReview] = useState<{ model: TradeActionConfirmModel; scope: object | undefined } | null>(null);
  const resolveRef = useRef<{ scope: object | undefined; resolve: (confirmed: boolean) => void } | null>(null);
  const currentScope = useRef(scope);
  currentScope.current = scope;

  const requestConfirmation = useCallback((next: TradeActionConfirmModel): Promise<boolean> => {
    // A late producer from an old session cannot open a private review.
    if (currentScope.current !== scope) return Promise.resolve(false);
    resolveRef.current?.resolve(false);
    setReview({ model: next, scope });
    return new Promise((resolve) => {
      resolveRef.current = { scope, resolve };
    });
  }, [scope]);

  const resolveConfirmation = useCallback((confirmed: boolean) => {
    const pending = resolveRef.current;
    // A callback retained from an old rendered modal cannot accept a new review.
    if (!pending || pending.scope !== scope) return;
    resolveRef.current = null;
    setReview(null);
    pending.resolve(confirmed && currentScope.current === scope);
  }, [scope]);

  useEffect(() => {
    const pending = resolveRef.current;
    if (pending && pending.scope !== scope) {
      resolveRef.current = null;
      pending.resolve(false);
    }
    setReview(previous => previous && previous.scope !== scope ? null : previous);
  }, [scope]);

  useEffect(
    () => () => {
      resolveRef.current?.resolve(false);
      resolveRef.current = null;
    },
    []
  );

  return {
    // Hide private content in the changed render, before the cancellation effect.
    confirmation: review && review.scope === scope ? review.model : null,
    requestConfirmation,
    resolveConfirmation
  };
}
