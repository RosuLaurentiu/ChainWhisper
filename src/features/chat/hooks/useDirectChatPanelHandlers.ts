import { useCallback, useRef } from 'react';
import {
  DEFAULT_TRADE_EXPIRY_HOURS,
  type PendingTradeCounterContext
} from '../../../lib/appHelpers';
import {
  sanitizeTokenAmountInput,
  type ChatMessage,
  type TipTokenSelection
} from '../../../lib/appShared';

type StateUpdate<T> = T | ((previous: T) => T);

type UseDirectChatPanelHandlersArgs = {
  browserWalletLiteMode: boolean;
  sendDirectImageMessage: (file: File) => Promise<void>;
  sendMessage: () => Promise<void>;
  sendTipToActiveContact: (token: TipTokenSelection, amountWei: bigint) => Promise<void>;
  setError: (next: string) => void;
  setReactionPickerMessageId: (next: StateUpdate<string | null>) => void;
  setReplyingToMessage: (next: StateUpdate<ChatMessage | null>) => void;
  setTipAmountInput: (next: StateUpdate<string>) => void;
  setTipComposerOpen: (next: StateUpdate<boolean>) => void;
  setTradeComposerOpen: (next: StateUpdate<boolean>) => void;
  setTradeCounterContext: (next: StateUpdate<PendingTradeCounterContext | null>) => void;
  setTradeCounterParentId: (next: StateUpdate<number | null>) => void;
  setTradeExpiryHoursInput: (next: StateUpdate<string>) => void;
  setTradeOfferAmountInput: (next: StateUpdate<string>) => void;
  setTradeRequestAmountInput: (next: StateUpdate<string>) => void;
  tipAmountWeiFromInput: bigint;
  tipTokenSelection: TipTokenSelection;
  tradeCounterParentId: number | null;
};

export default function useDirectChatPanelHandlers({
  browserWalletLiteMode,
  sendDirectImageMessage,
  sendMessage,
  sendTipToActiveContact,
  setError,
  setReactionPickerMessageId,
  setReplyingToMessage,
  setTipAmountInput,
  setTipComposerOpen,
  setTradeComposerOpen,
  setTradeCounterContext,
  setTradeCounterParentId,
  setTradeExpiryHoursInput,
  setTradeOfferAmountInput,
  setTradeRequestAmountInput,
  tipAmountWeiFromInput,
  tipTokenSelection,
  tradeCounterParentId
}: UseDirectChatPanelHandlersArgs) {
  const handleCancelReply = useCallback(() => setReplyingToMessage(null), [setReplyingToMessage]);

  const handleToggleTipComposer = useCallback(() => {
    setTradeComposerOpen(false);
    setTipComposerOpen((previous) => !previous);
  }, [setTipComposerOpen, setTradeComposerOpen]);

  const handleTipAmountInputChange = useCallback(
    (value: string) => setTipAmountInput(sanitizeTokenAmountInput(value)),
    [setTipAmountInput]
  );

  const handleToggleTradeComposer = useCallback(() => {
    setTipComposerOpen(false);
    setTradeComposerOpen((previous) => {
      const nextOpen = !previous;
      if (nextOpen && tradeCounterParentId === null) {
        setTradeCounterContext(null);
        setTradeOfferAmountInput('');
        setTradeRequestAmountInput('');
        setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
      }
      if (!nextOpen) {
        setTradeCounterParentId(null);
        setTradeCounterContext(null);
      }
      return nextOpen;
    });
  }, [
    setTipComposerOpen,
    setTradeComposerOpen,
    setTradeCounterContext,
    setTradeCounterParentId,
    setTradeExpiryHoursInput,
    setTradeOfferAmountInput,
    setTradeRequestAmountInput,
    tradeCounterParentId
  ]);

  const sendDirectImageMessageRef = useRef(sendDirectImageMessage);
  sendDirectImageMessageRef.current = sendDirectImageMessage;
  const handleSendImage = useCallback((file: File) => {
    sendDirectImageMessageRef.current(file).catch(() => {});
  }, []);

  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;
  const handleSendMessage = useCallback(() => {
    sendMessageRef.current().catch(() => {});
  }, []);

  const handleToggleReactionPicker = useCallback((messageId: string) => {
    if (browserWalletLiteMode) {
      return;
    }
    setReactionPickerMessageId((previous) => (previous === messageId ? null : messageId));
  }, [browserWalletLiteMode, setReactionPickerMessageId]);

  const handleReplyToMessage = useCallback((message: ChatMessage) => {
    if (browserWalletLiteMode) {
      setError('Use the ChainWhisper account to send replies.');
      return;
    }
    setReplyingToMessage(message);
  }, [browserWalletLiteMode, setError, setReplyingToMessage]);

  const tipSendStateRef = useRef({ tipTokenSelection, tipAmountWeiFromInput });
  tipSendStateRef.current = { tipTokenSelection, tipAmountWeiFromInput };
  const sendTipToActiveContactRef = useRef(sendTipToActiveContact);
  sendTipToActiveContactRef.current = sendTipToActiveContact;
  const handleSendTip = useCallback(() => {
    const { tipTokenSelection: token, tipAmountWeiFromInput: amount } = tipSendStateRef.current;
    sendTipToActiveContactRef.current(token, amount).catch(() => {});
  }, []);

  return {
    handleCancelReply,
    handleReplyToMessage,
    handleSendImage,
    handleSendMessage,
    handleSendTip,
    handleTipAmountInputChange,
    handleToggleReactionPicker,
    handleToggleTipComposer,
    handleToggleTradeComposer
  };
}
