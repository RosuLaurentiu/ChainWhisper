import { useEffect, useMemo, useState } from 'react';
import {
  ESTIMATED_DIRECT_TRADE_ACCESS_SECRET,
  ESTIMATED_DIRECT_TRADE_NOTIFICATION_TRADE_ID,
  resolveMetaMaskPromptEstimateTone
} from '../../../app/appHelpers';
import {
  buildTradeOfferMessagePayload,
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  encodeCompactMemoPlaintext,
  IMAGE_MESSAGE_PREFIX,
  isWalletAddress
} from '../../../lib/appShared';
import {
  buildDirectChatV2PromptEstimateMessage,
  buildDirectTradeV2PromptEstimateMessage,
  buildMetaMaskPromptEstimateMessage,
  estimateChatWalletPromptLoad,
  type DirectChatV2PromptConversationState
} from '../../../lib/chatWalletPromptEstimate';
import type { DirectChatV2SessionController } from '../../../lib/directChatV2Session';
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
  directChatV2ConversationKnown: boolean;
  directChatV2Session: DirectChatV2SessionController | null;
  directTradeV2Enabled: boolean;
  messageInput: string;
  parsedTradeExpiryHours: number;
  tradeComposerOpen: boolean;
  tradeCounterParentId: number | null;
  tradeOfferTokenKind: 'native' | 'erc20' | 'private-erc20' | null;
  tradeOfferTokenSymbol: string;
  walletAddress: string;
};

export default function useDirectComposerPromptEstimates({
  activeContact,
  activeGroupId,
  activeLinkedTradeContext,
  browserWalletLiteMode,
  directChatV2ConversationKnown,
  directChatV2Session,
  directTradeV2Enabled,
  messageInput,
  parsedTradeExpiryHours,
  tradeComposerOpen,
  tradeCounterParentId,
  tradeOfferTokenKind,
  tradeOfferTokenSymbol,
  walletAddress
}: UseDirectComposerPromptEstimatesArgs) {
  const normalizedActivePeer = activeContact?.trim().toLowerCase() ?? '';
  const [directChatV2Inspection, setDirectChatV2Inspection] = useState<{
    peer: string;
    session: DirectChatV2SessionController;
    state: 'existing' | 'new' | 'unavailable';
  } | null>(null);
  const directChatV2ConversationState: DirectChatV2PromptConversationState =
    directChatV2ConversationKnown
      ? 'existing'
      : !directChatV2Session
        ? 'unavailable'
        : directChatV2Inspection?.session === directChatV2Session &&
            directChatV2Inspection.peer === normalizedActivePeer
          ? directChatV2Inspection.state
          : 'checking';

  useEffect(() => {
    let disposed = false;
    const peer = activeContact?.trim() ?? '';
    if (!browserWalletLiteMode || activeGroupId !== null || !isWalletAddress(peer)) {
      return () => { disposed = true; };
    }
    if (directChatV2ConversationKnown) {
      return () => { disposed = true; };
    }
    if (!directChatV2Session) {
      return () => { disposed = true; };
    }

    void directChatV2Session.inspect(peer).then((conversation) => {
      if (!disposed) {
        setDirectChatV2Inspection({
          peer: peer.toLowerCase(),
          session: directChatV2Session,
          state: conversation.exists ? 'existing' : 'new'
        });
      }
    }).catch(() => {
      if (!disposed) {
        setDirectChatV2Inspection({
          peer: peer.toLowerCase(),
          session: directChatV2Session,
          state: 'unavailable'
        });
      }
    });
    return () => { disposed = true; };
  }, [
    activeContact,
    activeGroupId,
    browserWalletLiteMode,
    directChatV2ConversationKnown,
    directChatV2Session
  ]);

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

    if (directTradeV2Enabled) {
      return {
        tone: 'ok',
        label: buildDirectTradeV2PromptEstimateMessage({
          offerAssetKind: tradeOfferTokenKind ?? 'unknown',
          offerSymbol: tradeOfferTokenSymbol
        })
      };
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
    directTradeV2Enabled,
    parsedTradeExpiryHours,
    tradeComposerOpen,
    tradeCounterParentId,
    tradeOfferTokenKind,
    tradeOfferTokenSymbol,
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
    const estimateSubject = linkedTradeReference
      ? `this message with Trade #${linkedTradeReference.tradeId} reference`
      : 'this message';

    // MetaMask direct-chat writes are Chat V2-only. Never show ChatGC's
    // per-cell encryption estimate for an operation that cannot use ChatGC.
    return {
      tone: directChatV2ConversationState === 'unavailable' ? 'warning' : 'ok',
      label: buildDirectChatV2PromptEstimateMessage(
        estimateSubject,
        directChatV2ConversationState
      )
    };
  }, [
    activeGroupId,
    activeLinkedTradeContext,
    browserWalletLiteMode,
    directChatV2ConversationState,
    messageInput,
    tradeComposerOpen
  ]);

  return {
    directComposerPromptEstimate,
    tradeComposerPromptEstimate
  };
}
