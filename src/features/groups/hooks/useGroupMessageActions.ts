import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import { getOnChainFailureMessage, sanitizeOutgoingMessagePlainText } from '../../../lib/appHelpers';
import { sendChatImageAttachment } from '../../../lib/chatImageAttachment';
import type { ImageAttachmentPreviewState } from '../../../lib/imageAttachmentPreview';
import { submitGroupMemo } from '../../../lib/groupChatChain';
import {
  buildMessageWithReplyPayload,
  getGroupActionErrorMessage,
  getMessageDisplayText,
  IMAGE_MESSAGE_PREFIX,
  isWalletAddress,
  MAX_MESSAGE_LENGTH,
  mergeOnboardInfo,
  trimReplyPreview,
  type ChatMessage,
  type GroupFeeModeSelection,
  type SyncGroupOptions
} from '../../../lib/appShared';

type StateSetter<T> = (next: T | ((previous: T) => T)) => void;

type MemoSignerBundle = {
  signer: Wallet | JsonRpcSigner;
  cacheKey: string;
};

type UseGroupMessageActionsArgs = {
  activeGroupId: number | null;
  activeGroupIdRef: MutableRefObject<number | null>;
  browserWalletLiteMode: boolean;
  clearImageAttachmentStatus: () => void;
  currentWalletKeyRef: MutableRefObject<string>;
  encodeMemoForActiveSigner: (plain: string) => string;
  getMemoSigner: () => Promise<MemoSignerBundle>;
  groupFeeModeSelection: GroupFeeModeSelection;
  messageInput: string;
  privateRewardTokenBalanceWei: bigint | null;
  replyingToMessage: ChatMessage | null;
  resolveGroupSubmitSelector: () => Promise<string>;
  resolveRequiredFeeForGroupSend: () => Promise<bigint>;
  resolveRequiredTokenFeeForGroupSend: () => Promise<bigint>;
  runWalletTransactionFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  sendingGroupMessage: boolean;
  setError: (next: string) => void;
  setMessageInput: StateSetter<string>;
  setMessagesByGroup: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
  setReplyingToMessage: StateSetter<ChatMessage | null>;
  setSendingGroupMessage: StateSetter<boolean>;
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  setTopUpMetricsNonce: StateSetter<number>;
  setUploadingImage: StateSetter<boolean>;
  showImageAttachmentStatus: (status: ImageAttachmentPreviewState) => void;
  syncGroupData: (options?: SyncGroupOptions) => Promise<void>;
  uploadingImage: boolean;
  walletAddress: string;
};

export default function useGroupMessageActions({
  activeGroupId,
  activeGroupIdRef,
  browserWalletLiteMode,
  clearImageAttachmentStatus,
  currentWalletKeyRef,
  encodeMemoForActiveSigner,
  getMemoSigner,
  groupFeeModeSelection,
  messageInput,
  privateRewardTokenBalanceWei,
  replyingToMessage,
  resolveGroupSubmitSelector,
  resolveRequiredFeeForGroupSend,
  resolveRequiredTokenFeeForGroupSend,
  runWalletTransactionFlow,
  sendingGroupMessage,
  setError,
  setMessageInput,
  setMessagesByGroup,
  setReplyingToMessage,
  setSendingGroupMessage,
  setSessionOnboardInfo,
  setTopUpMetricsNonce,
  setUploadingImage,
  showImageAttachmentStatus,
  syncGroupData,
  uploadingImage,
  walletAddress
}: UseGroupMessageActionsArgs) {
  const sendGroupImageMessage = async (file: File) => {
    const targetGroupId = activeGroupId;
    const replyTarget = browserWalletLiteMode ? null : replyingToMessage;
    await sendChatImageAttachment({
      clearImageAttachmentStatus,
      failureFallbackMessage: 'Failed to send group image.',
      file,
      isTargetCurrent: () => activeGroupIdRef.current === targetGroupId,
      kind: 'group',
      missingTargetMessage: 'Select a group first.',
      sendImageTag: async (imageTag) => {
        const txHash = await sendGroupMessage(imageTag, replyTarget);
        if (!txHash) {
          throw new Error('Image message transaction was not confirmed.');
        }
        return txHash;
      },
      senderAddress: walletAddress,
      setError,
      setUploadingImage,
      showImageAttachmentStatus,
      targetChangedMessage: 'Group changed while the image was uploading. Please attach the image again.',
      targetMissing: targetGroupId === null,
      uploadingImage
    });
  };

  const sendGroupMessage = async (overrideMessageText?: string, overrideReplyTarget?: ChatMessage | null) => {
    setError('');

    if (sendingGroupMessage) {
      return;
    }
    if (activeGroupId === null) {
      setError('Select a group first.');
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
    if (plainText.startsWith(IMAGE_MESSAGE_PREFIX)) {
      setError('Image messages are disabled for security reasons.');
      return;
    }
    const requestedWalletAddress = walletAddress.trim();
    const requestedWalletKey = requestedWalletAddress.toLowerCase();
    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress)) {
      setError('Connect a wallet first.');
      return;
    }

    const groupId = activeGroupId;
    const groupKey = String(groupId);
    const replyTarget = browserWalletLiteMode ? null : overrideReplyTarget ?? replyingToMessage;
    const replyingPreviewText = replyTarget ? getMessageDisplayText(replyTarget.text) : undefined;
    const localMessageId = `local-group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const localMessageTimestamp = Math.floor(Date.now() / 1000);
    let confirmedTxHash = '';

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
            replyToText: replyingPreviewText ? trimReplyPreview(replyingPreviewText) : undefined,
            replyToTxHash: replyTarget?.txHash,
            replyToBlockNumber: replyTarget?.blockNumber,
            replyToLogIndex: replyTarget?.logIndex,
            timestamp: localMessageTimestamp,
            deliveryState: 'pending'
          }
        ]
      }));

      await runWalletTransactionFlow(async () => {
        const { signer, cacheKey } = await getMemoSigner();
        const selector = await resolveGroupSubmitSelector();
        const paymentMode = groupFeeModeSelection === 'token' ? 1 : 0;
        const requiredFee = paymentMode === 0 ? await resolveRequiredFeeForGroupSend() : 0n;
        const requiredTokenFee = paymentMode === 1 ? await resolveRequiredTokenFeeForGroupSend() : 0n;
        const plainTextWithReply = buildMessageWithReplyPayload(
          plainText,
          replyingPreviewText,
          replyTarget?.txHash,
          replyTarget?.blockNumber,
          replyTarget?.logIndex,
          true
        );
        const submittedTx = await submitGroupMemo({
          signer,
          groupId,
          plainText: plainTextWithReply,
          selector,
          paymentMode,
          requestedWalletAddress,
          requiredFee,
          requiredTokenFee,
          privateRewardTokenBalanceWei,
          encodeMemo: encodeMemoForActiveSigner
        });
        const submittedTxHash = submittedTx.txHash;
        if (currentWalletKeyRef.current !== requestedWalletKey) {
          return;
        }

        setMessagesByGroup((previous) => ({
          ...previous,
          [groupKey]: (previous[groupKey] ?? []).map((message) =>
            message.id === localMessageId ? { ...message, txHash: submittedTxHash || undefined } : message
          )
        }));

        const receipt = await submittedTx.wait();
        if (!receipt || Number((receipt as { status?: number | bigint }).status ?? 0) !== 1) {
          throw new Error('Transaction failed on-chain.');
        }
        confirmedTxHash =
          submittedTxHash ||
          (typeof (receipt as { transactionHash?: unknown }).transactionHash === 'string'
            ? (receipt as { transactionHash: string }).transactionHash
            : '');

        if (currentWalletKeyRef.current !== requestedWalletKey) {
          return;
        }

        setMessagesByGroup((previous) => ({
          ...previous,
          [groupKey]: (previous[groupKey] ?? []).map((message) =>
            message.id === localMessageId
              ? {
                  ...message,
                  deliveryState: 'sent',
                  txHash: submittedTxHash || undefined
                }
              : message
          )
        }));

        const nextOnboardInfo = signer.getUserOnboardInfo();
        setSessionOnboardInfo((previous) => ({
          ...previous,
          [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
        }));

        if (typeof overrideMessageText === 'undefined') {
          setMessageInput('');
        }
        setReplyingToMessage(null);
        await syncGroupData({ background: true, activeMessagesOnly: true });
        setTopUpMetricsNonce((previous) => previous + 1);
      });
    } catch (sendError) {
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }
      const message = getGroupActionErrorMessage(sendError, getOnChainFailureMessage(sendError, 'Failed to send group message.'));
      setError(message);
      setMessagesByGroup((previous) => ({
        ...previous,
        [groupKey]: (previous[groupKey] ?? []).map((messageRecord) =>
          messageRecord.id === localMessageId
            ? {
                ...messageRecord,
                deliveryState: 'failed'
              }
            : messageRecord
        )
      }));
    } finally {
      setSendingGroupMessage(false);
    }
    return confirmedTxHash || undefined;
  };

  return {
    sendGroupImageMessage,
    sendGroupMessage
  };
}
