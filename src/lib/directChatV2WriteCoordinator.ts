import { getAddress } from '@coti-io/coti-ethers';
import { historyEntryToChatMessage } from './directConversationSyncHelpers';
import { buildDirectChatV2MessageKey } from './directChatV2Chain';
import { deriveDirectChatV2ConversationId } from './directChatV2Crypto';
import { mapDecodedDirectChatV2HistoryEvent } from './directChatV2History';
import {
  decodeDirectChatV2Payload,
  encodeDirectChatV2Payload,
  type DirectChatV2Payload
} from './directChatV2Payload';
import {
  assertDirectChatV2SessionController,
  type DirectChatV2SendInput,
  type DirectChatV2SendResult,
  type DirectChatV2SessionController
} from './directChatV2Session';
import {
  parseChatMessagePayload,
  type ChatMessage,
  type TradeMessageReferencePayload
} from './appShared';

export const DIRECT_CHAT_V2_WRITE_DISABLED = Object.freeze({ enabled: false as const });

export type DirectChatV2WriteLifecycle = {
  onOptimistic: (update: DirectChatV2OptimisticUpdate) => void | Promise<void>;
  onReceipt: (update: DirectChatV2ReceiptUpdate) => void | Promise<void>;
  onFailure: (update: DirectChatV2FailureUpdate) => void | Promise<void>;
};

export type DirectChatV2OptimisticUpdate = {
  contactKey: string;
  message: ChatMessage;
};

export type DirectChatV2ReceiptUpdate = {
  contactKey: string;
  optimisticId: string;
  confirmedMessage: ChatMessage;
};

export type DirectChatV2FailureUpdate = {
  contactKey: string;
  optimisticId: string;
  error: unknown;
};

export type DirectChatV2PreparedWrite = {
  peer: string;
  payload: DirectChatV2SendInput;
  optimisticMessage: ChatMessage;
  shouldContinue?: () => boolean;
};

export type DirectChatV2CoordinatedWriteResult = DirectChatV2SendResult & {
  confirmedMessage: ChatMessage;
  optimisticId: string;
  reconciled: boolean;
};

export type DirectChatV2WriteCoordinator =
  | {
      readonly enabled: false;
      send: (write: DirectChatV2PreparedWrite) => Promise<DirectChatV2CoordinatedWriteResult>;
    }
  | {
      readonly enabled: true;
      readonly ownerAddress: string;
      send: (write: DirectChatV2PreparedWrite) => Promise<DirectChatV2CoordinatedWriteResult>;
    };

export type DirectChatV2WriteConfig =
  | typeof DIRECT_CHAT_V2_WRITE_DISABLED
  | {
      enabled: true;
      mode: 'metamask-owner';
      ownerAddress: string;
      session: DirectChatV2SessionController;
      lifecycle: DirectChatV2WriteLifecycle;
    };

const tradeReferencesMatch = (
  left?: TradeMessageReferencePayload,
  right?: TradeMessageReferencePayload
): boolean => {
  if (!left || !right) return left === right;
  return (
    left.version === right.version &&
    left.tradeId === right.tradeId &&
    left.escrowContract.toLowerCase() === right.escrowContract.toLowerCase() &&
    left.terminalPath === right.terminalPath
  );
};

const snapshotPayload = (input: DirectChatV2SendInput): {
  payload: DirectChatV2Payload;
  sendInput: DirectChatV2SendInput;
} => {
  if (input.tip !== undefined && input.tip < 0n) {
    throw new Error('Direct-chat V2 tip cannot be negative.');
  }
  const payload = decodeDirectChatV2Payload(encodeDirectChatV2Payload(input));
  return {
    payload,
    sendInput: Object.freeze({
      body: payload.body,
      ...(payload.replyToMessageId === undefined ? {} : { replyToMessageId: payload.replyToMessageId }),
      ...(payload.replyToMessageAnchor === undefined
        ? {}
        : { replyToMessageAnchor: payload.replyToMessageAnchor }),
      ...(payload.replyPreview === undefined ? {} : { replyPreview: payload.replyPreview }),
      ...(input.tip === undefined ? {} : { tip: input.tip })
    })
  };
};

const assertPayloadsMatch = (actual: DirectChatV2Payload, expected: DirectChatV2Payload): void => {
  if (
    actual.version !== expected.version ||
    actual.body !== expected.body ||
    actual.replyToMessageId !== expected.replyToMessageId ||
    actual.replyToMessageAnchor !== expected.replyToMessageAnchor ||
    actual.replyPreview !== expected.replyPreview
  ) {
    throw new Error('Chat V2 receipt payload does not match the prepared message.');
  }
};

const assertOptimisticMessage = ({
  message,
  ownerAddress,
  payload,
  expectedReplyToMessageId
}: {
  message: ChatMessage;
  ownerAddress: string;
  payload: DirectChatV2Payload;
  expectedReplyToMessageId?: string;
}): void => {
  if (!/^local-direct-v2-[a-zA-Z0-9_-]+$/.test(message.id)) {
    throw new Error('Chat V2 optimistic messages require a unique local-direct-v2 ID.');
  }
  if (
    message.direction !== 'outgoing' ||
    message.deliveryState !== 'pending' ||
    message.accountRole !== 'owner' ||
    message.directV2 !== undefined ||
    message.txHash !== undefined
  ) {
    throw new Error('Chat V2 optimistic message is not an unconfirmed owner-wallet send.');
  }
  const ownerKey = ownerAddress.toLowerCase();
  if (
    getAddress(message.senderAddress ?? '').toLowerCase() !== ownerKey ||
    getAddress(message.accountAddress ?? '').toLowerCase() !== ownerKey
  ) {
    throw new Error('Chat V2 optimistic message is not scoped to the owner wallet.');
  }

  const parsed = parseChatMessagePayload(payload.body);
  if (
    message.text !== parsed.cleanText ||
    message.replyToMessageId !== expectedReplyToMessageId ||
    message.replyToMessageAnchor !== payload.replyToMessageAnchor ||
    (message.replyToText ?? '') !== (payload.replyPreview ?? parsed.replyToText ?? '') ||
    (message.replyToTxHash ?? '').toLowerCase() !== (parsed.replyToTxHash ?? '').toLowerCase() ||
    message.replyToBlockNumber !== parsed.replyToBlockNumber ||
    message.replyToLogIndex !== parsed.replyToLogIndex ||
    !tradeReferencesMatch(message.tradeReference, parsed.tradeReference)
  ) {
    throw new Error('Chat V2 optimistic message does not match the prepared payload builders.');
  }
};

const assertConfirmedMatchesOptimistic = (
  confirmed: ChatMessage,
  optimistic: ChatMessage
): void => {
  if (
    confirmed.text !== optimistic.text ||
    (confirmed.replyToMessageId ?? '') !== (optimistic.replyToMessageId ?? '') ||
    (confirmed.replyToMessageAnchor ?? '') !== (optimistic.replyToMessageAnchor ?? '') ||
    (confirmed.replyToText ?? '') !== (optimistic.replyToText ?? '') ||
    (confirmed.replyToTxHash ?? '').toLowerCase() !== (optimistic.replyToTxHash ?? '').toLowerCase() ||
    confirmed.replyToBlockNumber !== optimistic.replyToBlockNumber ||
    confirmed.replyToLogIndex !== optimistic.replyToLogIndex ||
    !tradeReferencesMatch(confirmed.tradeReference, optimistic.tradeReference)
  ) {
    throw new Error('Confirmed Chat V2 message does not match its exact optimistic record.');
  }
};

const identityMatches = (left: ChatMessage, right: ChatMessage): boolean => {
  const leftIdentity = left.directV2;
  const rightIdentity = right.directV2;
  if (!leftIdentity || !rightIdentity) return false;
  return (
    left.id === right.id &&
    leftIdentity.protocol === rightIdentity.protocol &&
    leftIdentity.chainId === rightIdentity.chainId &&
    leftIdentity.contractAddress.toLowerCase() === rightIdentity.contractAddress.toLowerCase() &&
    leftIdentity.conversationId.toLowerCase() === rightIdentity.conversationId.toLowerCase() &&
    leftIdentity.messageId === rightIdentity.messageId &&
    leftIdentity.epoch === rightIdentity.epoch &&
    leftIdentity.senderSequence === rightIdentity.senderSequence &&
    leftIdentity.nonce.toLowerCase() === rightIdentity.nonce.toLowerCase() &&
    leftIdentity.transactionHash.toLowerCase() === rightIdentity.transactionHash.toLowerCase() &&
    leftIdentity.blockNumber === rightIdentity.blockNumber &&
    leftIdentity.blockHash.toLowerCase() === rightIdentity.blockHash.toLowerCase() &&
    leftIdentity.logIndex === rightIdentity.logIndex
  );
};

const normalizeContactKey = (value: string): string => getAddress(value.trim()).toLowerCase();

export const appendDirectChatV2OptimisticMessage = (
  previous: Record<string, ChatMessage[]>,
  update: DirectChatV2OptimisticUpdate
): Record<string, ChatMessage[]> => {
  const contactKey = normalizeContactKey(update.contactKey);
  if (Object.values(previous).some((messages) => messages.some(({ id }) => id === update.message.id))) {
    throw new Error('Chat V2 optimistic message ID is already present.');
  }
  return {
    ...previous,
    [contactKey]: [...(previous[contactKey] ?? []), update.message]
  };
};

/**
 * Applies the only supported V2 optimistic replacement: one explicit local ID
 * to one receipt-authenticated stable message ID. V2 history sync must use
 * `pruneOptimisticOutgoing: false`; the legacy content matcher is not exact.
 */
export const applyDirectChatV2ReceiptUpdate = (
  previous: Record<string, ChatMessage[]>,
  update: DirectChatV2ReceiptUpdate
): Record<string, ChatMessage[]> => {
  const contactKey = normalizeContactKey(update.contactKey);
  const existing = previous[contactKey] ?? [];
  const optimisticMatches = existing.filter(({ id }) => id === update.optimisticId);
  const confirmedMatches = existing.filter(({ id }) => id === update.confirmedMessage.id);
  if (optimisticMatches.length > 1 || confirmedMatches.length > 1) {
    throw new Error('Chat V2 message state contains duplicate reconciliation identities.');
  }
  if (confirmedMatches.length === 1 && !identityMatches(confirmedMatches[0], update.confirmedMessage)) {
    throw new Error('Existing Chat V2 stable identity conflicts with the confirmed receipt.');
  }
  if (optimisticMatches.length === 0 && confirmedMatches.length === 0) {
    throw new Error('Chat V2 optimistic message is unavailable for exact receipt reconciliation.');
  }

  if (confirmedMatches.length === 1) {
    const existingConfirmed = confirmedMatches[0];
    const keepFinalized = existingConfirmed.directV2?.finality === 'finalized';
    const finalizedReceiptMessage = keepFinalized && update.confirmedMessage.directV2
      ? {
          ...update.confirmedMessage,
          directV2: {
            ...update.confirmedMessage.directV2,
            finality: 'finalized' as const
          }
        }
      : update.confirmedMessage;
    return {
      ...previous,
      [contactKey]: existing
        .filter(({ id }) => id !== update.optimisticId)
        .map((message) => message.id === update.confirmedMessage.id
          ? keepFinalized
            ? finalizedReceiptMessage
            : update.confirmedMessage
          : message)
    };
  }

  return {
    ...previous,
    [contactKey]: existing.map((message) =>
      message.id === update.optimisticId ? update.confirmedMessage : message
    )
  };
};

export const failDirectChatV2OptimisticMessage = (
  previous: Record<string, ChatMessage[]>,
  update: Pick<DirectChatV2FailureUpdate, 'contactKey' | 'optimisticId'>
): Record<string, ChatMessage[]> => {
  const contactKey = normalizeContactKey(update.contactKey);
  const existing = previous[contactKey] ?? [];
  let changed = false;
  const next = existing.map((message) => {
    if (message.id !== update.optimisticId || message.directV2) return message;
    changed = true;
    return { ...message, deliveryState: 'failed' as const };
  });
  return changed ? { ...previous, [contactKey]: next } : previous;
};

const assertScopeCurrent = (shouldContinue?: () => boolean): void => {
  if (shouldContinue && !shouldContinue()) {
    throw new Error('Direct-chat V2 write scope changed before submission.');
  }
};

export const createDirectChatV2WriteCoordinator = (
  config: DirectChatV2WriteConfig
): DirectChatV2WriteCoordinator => {
  if (!config.enabled) {
    return Object.freeze({
      enabled: false as const,
      send: async (_write: DirectChatV2PreparedWrite) => {
        throw new Error('Direct-chat V2 writes are not activated.');
      }
    });
  }

  if (config.mode !== 'metamask-owner') {
    throw new Error('Direct-chat V2 writes require browser-wallet owner mode.');
  }
  assertDirectChatV2SessionController(config.session);
  // Capture the opaque capability so caller-owned config cannot swap it later.
  const session = config.session;
  const lifecycle = Object.freeze({
    onOptimistic: config.lifecycle.onOptimistic,
    onReceipt: config.lifecycle.onReceipt,
    onFailure: config.lifecycle.onFailure
  });
  const ownerAddress = getAddress(config.ownerAddress.trim());
  if (getAddress(session.ownerAddress).toLowerCase() !== ownerAddress.toLowerCase()) {
    throw new Error('Direct-chat V2 write session belongs to a different owner wallet.');
  }

  return Object.freeze({
    enabled: true as const,
    ownerAddress,
    send: async (write: DirectChatV2PreparedWrite): Promise<DirectChatV2CoordinatedWriteResult> => {
      const shouldContinue = write.shouldContinue;
      const peer = getAddress(write.peer.trim());
      if (peer.toLowerCase() === ownerAddress.toLowerCase()) {
        throw new Error('Direct-chat V2 cannot send a message to the owner wallet itself.');
      }
      const { payload, sendInput } = snapshotPayload(write.payload);
      const conversationId = deriveDirectChatV2ConversationId({
        chainId: session.manifest.chainId,
        contractAddress: session.manifest.contractAddress,
        participantA: ownerAddress,
        participantB: peer
      });
      const expectedReplyToMessageId = payload.replyToMessageId === undefined
        ? undefined
        : buildDirectChatV2MessageKey({
            chainId: session.manifest.chainId,
            contractAddress: session.manifest.contractAddress,
            conversationId,
            messageId: payload.replyToMessageId
          });
      const optimisticMessage = Object.freeze({
        ...write.optimisticMessage,
        ...(write.optimisticMessage.tradeReference
          ? { tradeReference: Object.freeze({ ...write.optimisticMessage.tradeReference }) }
          : {})
      });
      assertOptimisticMessage({
        message: optimisticMessage,
        ownerAddress,
        payload,
        expectedReplyToMessageId
      });
      assertScopeCurrent(shouldContinue);

      const contactKey = peer.toLowerCase();
      const optimisticUpdate = { contactKey, message: optimisticMessage };
      let result: DirectChatV2SendResult;
      let confirmedMessage: ChatMessage;
      let optimisticInserted = false;
      try {
        assertScopeCurrent(shouldContinue);
        await session.ensure(peer);
        assertScopeCurrent(shouldContinue);
        await lifecycle.onOptimistic(optimisticUpdate);
        optimisticInserted = true;
        assertScopeCurrent(shouldContinue);
        result = await session.send(peer, sendInput);
        assertPayloadsMatch(result.payload, payload);
        if (
          result.event.sender.toLowerCase() !== ownerAddress.toLowerCase() ||
          result.event.recipient.toLowerCase() !== peer.toLowerCase()
        ) {
          throw new Error('Chat V2 receipt is outside the prepared owner-to-peer scope.');
        }
        const historyEntry = mapDecodedDirectChatV2HistoryEvent({
          event: result.event,
          payload: result.payload,
          viewerAddress: ownerAddress,
          accountRole: 'owner',
          finality: 'confirmed',
          timestamp: optimisticMessage.timestamp
        });
        confirmedMessage = {
          ...historyEntryToChatMessage(historyEntry, ownerAddress),
          senderAddress: ownerAddress,
          deliveryState: 'sent'
        };
        assertConfirmedMatchesOptimistic(confirmedMessage, optimisticMessage);
      } catch (error) {
        if (optimisticInserted && (!shouldContinue || shouldContinue())) {
          await lifecycle.onFailure({
            contactKey,
            optimisticId: optimisticMessage.id,
            error
          });
        }
        throw error;
      }

      const reconciled = !shouldContinue || shouldContinue();
      if (reconciled) {
        await lifecycle.onReceipt({
          contactKey,
          optimisticId: optimisticMessage.id,
          confirmedMessage
        });
      }
      return {
        ...result,
        confirmedMessage,
        optimisticId: optimisticMessage.id,
        reconciled
      };
    }
  });
};
