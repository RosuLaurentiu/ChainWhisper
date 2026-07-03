import { useMemo } from 'react';
import {
  ESTIMATED_DIRECT_TRADE_ACCESS_SECRET,
  ESTIMATED_DIRECT_TRADE_NOTIFICATION_TRADE_ID,
  resolveMetaMaskPromptEstimateTone
} from '../../../app/appHelpers';
import {
  buildMessageWithTradeReferencePayload,
  buildTradeOfferMessagePayload,
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  encodeCompactMemoPlaintext,
  IMAGE_MESSAGE_PREFIX,
  isWalletAddress
} from '../../../lib/appShared';
import {
  buildMetaMaskPromptEstimateMessage,
  estimateChatWalletPromptLoad
} from '../../../lib/chatWalletPromptEstimate';
import { buildTradeMessageReferenceFromContext, type LinkedTradeContext } from '../../../lib/linkedTradeContext';
import { sanitizeOutgoingMessagePlainText } from '../../../lib/appHelpers';

type PromptEstimateNotice = {
  label: string;
  tone: 'ok' | 'warning';
};

type UseDirectComposerPromptEstimatesArgs = {
  activeContact: string | null;
  activeGroupId: number | null;
  activeLinkedTradeContext: LinkedTradeContext | null;
  browserWalletLiteMode: boolean;
  messageInput: string;
  parsedTradeExpiryHours: number;
  tradeComposerOpen: boolean;
  tradeCounterParentId: number | null;
  walletAddress: string;
};

export default function useDirectComposerPromptEstimates({
  activeContact,
  activeGroupId,
  activeLinkedTradeContext,
  browserWalletLiteMode,
  messageInput,
  parsedTradeExpiryHours,
  tradeComposerOpen,
  tradeCounterParentId,
  walletAddress
}: UseDirectComposerPromptEstimatesArgs) {
  const tradeComposerPromptEstimate = useMemo<PromptEstimateNotice | null>(() => {
    const makerAddress = walletAddress.trim();
    const takerAddress = activeContact?.trim() ?? '';
    if (
      !browserWalletLiteMode ||
      !tradeComposerOpen ||
      activeGroupId !== null ||
      !isWalletAddress(makerAddress) ||
      !isWalletAddress(takerAddress)
    ) {
      return null;
    }

    const createdAt = Math.floor(Date.now() / 1000);
    const payload = buildTradeOfferMessagePayload({
      version: 2,
      tradeId: ESTIMATED_DIRECT_TRADE_NOTIFICATION_TRADE_ID,
      escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
      maker: makerAddress,
      taker: takerAddress,
      createdAt,
      expiresAt: createdAt + parsedTradeExpiryHours * 3600,
      parentTradeId: tradeCounterParentId ?? undefined,
      accessSecret: ESTIMATED_DIRECT_TRADE_ACCESS_SECRET
    });
    const estimate = estimateChatWalletPromptLoad(payload, encodeCompactMemoPlaintext);

    return {
      tone: resolveMetaMaskPromptEstimateTone(estimate),
      label: buildMetaMaskPromptEstimateMessage(estimate, 'the trade notification')
    };
  }, [
    activeContact,
    activeGroupId,
    browserWalletLiteMode,
    parsedTradeExpiryHours,
    tradeComposerOpen,
    tradeCounterParentId,
    walletAddress
  ]);

  const directComposerPromptEstimate = useMemo<PromptEstimateNotice | null>(() => {
    if (!browserWalletLiteMode || activeGroupId !== null || tradeComposerOpen) {
      return null;
    }

    const plainText = sanitizeOutgoingMessagePlainText(messageInput).trim();
    if (!plainText || plainText.startsWith(IMAGE_MESSAGE_PREFIX)) {
      return null;
    }

    const linkedTradeReference = activeLinkedTradeContext
      ? buildTradeMessageReferenceFromContext(activeLinkedTradeContext)
      : undefined;
    const plainTextWithMetadata = buildMessageWithTradeReferencePayload(plainText, linkedTradeReference);
    const estimate = estimateChatWalletPromptLoad(plainTextWithMetadata, encodeCompactMemoPlaintext);
    const estimateSubject = linkedTradeReference
      ? `this message with Trade #${linkedTradeReference.tradeId} reference`
      : 'this message';

    return {
      tone: resolveMetaMaskPromptEstimateTone(estimate),
      label: buildMetaMaskPromptEstimateMessage(estimate, estimateSubject)
    };
  }, [activeGroupId, activeLinkedTradeContext, browserWalletLiteMode, messageInput, tradeComposerOpen]);

  return {
    directComposerPromptEstimate,
    tradeComposerPromptEstimate
  };
}
