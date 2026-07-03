import { useCallback, useEffect, useRef } from 'react';
import type { StateUpdate } from '../state/storeUtils';

type UseClipboardFeedbackArgs = {
  feedbackDurationMs: number;
  onError: (message: string) => void;
  setLastCopiedKey: (next: StateUpdate<string | null>) => void;
};

export default function useClipboardFeedback({
  feedbackDurationMs,
  onError,
  setLastCopiedKey
}: UseClipboardFeedbackArgs) {
  const copyFeedbackTimeoutRef = useRef<number | null>(null);

  const copyAddressToClipboard = useCallback(async (value: string): Promise<boolean> => {
    onError('');

    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      try {
        const tempInput = document.createElement('textarea');
        tempInput.value = value;
        tempInput.style.position = 'fixed';
        tempInput.style.opacity = '0';
        document.body.appendChild(tempInput);
        tempInput.focus();
        tempInput.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(tempInput);
        if (!copied) {
          throw new Error('Clipboard copy command was rejected.');
        }
        return true;
      } catch {
        onError('Could not copy address to clipboard.');
        return false;
      }
    }
  }, [onError]);

  const copyWithFeedback = useCallback(async (value: string, feedbackKey: string) => {
    const copied = await copyAddressToClipboard(value);
    if (!copied) {
      return;
    }

    setLastCopiedKey(feedbackKey);
    if (copyFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(copyFeedbackTimeoutRef.current);
      copyFeedbackTimeoutRef.current = null;
    }

    copyFeedbackTimeoutRef.current = window.setTimeout(() => {
      setLastCopiedKey((previous) => (previous === feedbackKey ? null : previous));
      copyFeedbackTimeoutRef.current = null;
    }, feedbackDurationMs);
  }, [copyAddressToClipboard, feedbackDurationMs, setLastCopiedKey]);

  useEffect(
    () => () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
        copyFeedbackTimeoutRef.current = null;
      }
    },
    []
  );

  return { copyWithFeedback };
}
