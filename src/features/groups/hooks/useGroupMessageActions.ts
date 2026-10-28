import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { getOnChainFailureMessage, sanitizeOutgoingMessagePlainText } from '../../../lib/appHelpers';
import { sendChatImageAttachment } from '../../../lib/chatImageAttachment';
import { getChatReplySourceAnchor } from '../../../lib/chatReplySourceAnchor';
import type { GroupChatV2SessionController } from '../../../lib/groupChatV2Session';
import type { ImageAttachmentPreviewState } from '../../../lib/imageAttachmentPreview';
import { parseImageTag } from '../../../lib/imagePull';
import {
  getGroupActionErrorMessage,
  getMessageDisplayText,
  IMAGE_MESSAGE_PREFIX,
  isWalletAddress,
  MAX_MESSAGE_LENGTH,
  trimReplyPreview,
  type ChatMessage
} from '../../../lib/appShared';

type StateSetter<T> = (next: T | ((previous: T) => T)) => void;

type UseGroupMessageActionsArgs = {
  activeGroupId: number | null;
  activeGroupIdRef: MutableRefObject<number | null>;
  clearImageAttachmentStatus: () => void;
  currentWalletKeyRef: MutableRefObject<string>;
  groupChatV2Session?: GroupChatV2SessionController | null;
  getGroupChatV2ImageSessionToken?: (() => Promise<string>) | null;
  isGroupChatV2ScopeCurrent?: () => boolean;
  messageInput: string;
  replyingToMessage: ChatMessage | null;
  sendingGroupMessage: boolean;
  setError: (next: string) => void;
  setMessageInput: StateSetter<string>;
  setMessagesByGroup: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
  setReplyingToMessage: StateSetter<ChatMessage | null>;
  setSendingGroupMessage: StateSetter<boolean>;
  setWalletBalanceRefreshNonce: StateSetter<number>;
  setUploadingImage: StateSetter<boolean>;
  showImageAttachmentStatus: (status: ImageAttachmentPreviewState) => void;
  uploadingImage: boolean;
  walletAddress: string;
};

/** Group writes are Group Chat V2-only. Legacy group history is deliberately read-only. */
export default function useGroupMessageActions({
  activeGroupId,
  activeGroupIdRef,
  clearImageAttachmentStatus,
  currentWalletKeyRef,
  groupChatV2Session = null,
  getGroupChatV2ImageSessionToken = null,
  isGroupChatV2ScopeCurrent = () => false,
  messageInput,
  replyingToMessage,
  sendingGroupMessage,
  setError,
  setMessageInput,
  setMessagesByGroup,
  setReplyingToMessage,
  setSendingGroupMessage,
  setWalletBalanceRefreshNonce,
  setUploadingImage,
  showImageAttachmentStatus,
  uploadingImage,
  walletAddress
}: UseGroupMessageActionsArgs) {
  const sendGroupImageMessage = async (file: File) => {
    if (!groupChatV2Session) {
      setError('Group Chat V2 is unavailable. No legacy image message was sent.');
      return;
    }
    if (!getGroupChatV2ImageSessionToken) {
      setError('Encrypted image upload sessions are unavailable for Group Chat V2.');
      return;
    }
    const targetGroupId = activeGroupId;
    await sendChatImageAttachment({
      clearImageAttachmentStatus,
      conversationTarget: targetGroupId === null ? '' : String(targetGroupId),
      failureFallbackMessage: 'Failed to send group image.',
      file,
      isTargetCurrent: () => activeGroupIdRef.current === targetGroupId && isGroupChatV2ScopeCurrent(),
      kind: 'group',
      missingTargetMessage: 'Select a group first.',
      sendImageTag: async (imageTag) => {
        const txHash = await sendGroupMessage(imageTag, replyingToMessage, true);
        if (!txHash) throw new Error('Image message transaction was not confirmed.');
        return txHash;
      },
      senderAddress: walletAddress,
      uploadAuthorization: {
        mode: 'session',
        protocol: 'group-v2',
        token: getGroupChatV2ImageSessionToken
      },
      setError,
      setUploadingImage,
      showImageAttachmentStatus,
      targetChangedMessage: 'Group changed while the image was uploading. Please attach the image again.',
      targetMissing: targetGroupId === null,
      uploadingImage
    });
  };

  const sendGroupMessage = async (
    overrideMessageText?: string,
    overrideReplyTarget?: ChatMessage | null,
    allowPreparedImageTag = false
  ) => {
    setError('');
    if (sendingGroupMessage) return;
    if (activeGroupId === null) {
      setError('Select a group first.');
      return;
    }
    if (!groupChatV2Session) {
      setError('Group Chat V2 is unavailable. No legacy message was sent.');
      return;
    }

    const plainText = sanitizeOutgoingMessagePlainText(overrideMessageText ?? messageInput).trim();
    if (!plainText) {
      setError('Enter a message first.');
      return;
    }
    if (plainText.length > MAX_MESSAGE_LENGTH) {
      setError(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`);
      return;
    }
    const parsedImageTag = parseImageTag(plainText);
    if (plainText.startsWith(IMAGE_MESSAGE_PREFIX) || (parsedImageTag !== null && !allowPreparedImageTag)) {
      setError('Image messages are disabled for security reasons.');
      return;
    }

    const requestedWalletAddress = walletAddress.trim();
    const requestedWalletKey = requestedWalletAddress.toLowerCase();
    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress)) {
      setError('Connect a wallet first.');
      return;
    }
    if (!isGroupChatV2ScopeCurrent()) {
      setError('Group Chat V2 wallet scope changed before submission.');
      return;
    }

    const groupId = activeGroupId;
    const groupKey = String(groupId);
    const replyTarget = overrideReplyTarget ?? replyingToMessage;
    if (replyTarget && !replyTarget.groupV2) {
      setError('Group Chat V2 replies can target only messages from the new group protocol.');
      return;
    }
    const replyAnchorCandidate = replyTarget ? getChatReplySourceAnchor(replyTarget) : null;
    if (replyTarget && !replyAnchorCandidate) {
      setError('Group Chat V2 could not authenticate the reply target.');
      return;
    }
    const replyToMessageAnchor = replyAnchorCandidate ?? undefined;
    const replyingPreviewText = replyTarget ? getMessageDisplayText(replyTarget.text) : undefined;
    const localMessageId = `local-group-v2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const localMessageTimestamp = Math.floor(Date.now() / 1000);

    try {
      setSendingGroupMessage(true);
      setMessagesByGroup((previous) => ({
        ...previous,
        [groupKey]: [
          ...(previous[groupKey] ?? []),
          {
            id: localMessageId,
            direction: 'outgoing',
            text: plainText,
            senderAddress: requestedWalletAddress,
            replyToMessageId: replyTarget?.id,
            replyToMessageAnchor,
            replyToText: replyingPreviewText ? trimReplyPreview(replyingPreviewText) : undefined,
            timestamp: localMessageTimestamp,
            deliveryState: 'pending'
          }
        ]
      }));
      const result = await groupChatV2Session.send(BigInt(groupId), {
        body: plainText,
        ...(replyTarget?.groupV2 ? { replyToMessageId: BigInt(replyTarget.groupV2.messageId) } : {}),
        ...(replyToMessageAnchor ? { replyToMessageAnchor } : {}),
        ...(replyTarget?.groupV2 && replyingPreviewText
          ? { replyPreview: trimReplyPreview(replyingPreviewText) }
          : {})
      });
      if (!isGroupChatV2ScopeCurrent() || currentWalletKeyRef.current !== requestedWalletKey) return;

      setMessagesByGroup((previous) => ({
        ...previous,
        [groupKey]: (previous[groupKey] ?? []).map((message) =>
          message.id === localMessageId
            ? {
                ...message,
                id: result.event.key,
                deliveryState: 'sent',
                txHash: result.transactionHash,
                blockNumber: Number(result.event.blockNumber),
                logIndex: result.event.logIndex,
                groupV2: {
                  protocol: 'group-v2',
                  contentState: 'available',
                  chainId: result.event.chainId.toString(),
                  contractAddress: result.event.contractAddress,
                  groupId: result.event.groupId.toString(),
                  messageId: result.event.messageId.toString(),
                  epoch: result.event.epoch.toString(),
                  membershipRevision: result.event.membershipRevision.toString(),
                  senderSequence: result.event.senderSequence.toString(),
                  nonce: result.event.nonce,
                  transactionHash: result.event.transactionHash,
                  blockNumber: result.event.blockNumber.toString(),
                  blockHash: result.event.blockHash,
                  logIndex: result.event.logIndex,
                  finality: 'confirmed'
                }
              }
            : message
        )
      }));
      if (typeof overrideMessageText === 'undefined') setMessageInput('');
      setReplyingToMessage(null);
      setWalletBalanceRefreshNonce((previous) => previous + 1);
      return result.transactionHash || undefined;
    } catch (sendError) {
      if (currentWalletKeyRef.current !== requestedWalletKey) return;
      setError(getGroupActionErrorMessage(
        sendError,
        getOnChainFailureMessage(sendError, 'Failed to send group message.')
      ));
      setMessagesByGroup((previous) => ({
        ...previous,
        [groupKey]: (previous[groupKey] ?? []).map((message) =>
          message.id === localMessageId ? { ...message, deliveryState: 'failed' } : message
        )
      }));
    } finally {
      setSendingGroupMessage(false);
    }
  };

  return { sendGroupImageMessage, sendGroupMessage };
}
