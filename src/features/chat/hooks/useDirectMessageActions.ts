import { useCallback, type MutableRefObject } from 'react';
import {
  getOnChainFailureMessage,
  sanitizeOutgoingMessagePlainText
} from '../../../lib/appHelpers';
import { sendChatImageAttachment } from '../../../lib/chatImageAttachment';
import { getChatReplySourceAnchor } from '../../../lib/chatReplySourceAnchor';
import type { DirectChatV2WriteCoordinator } from '../../../lib/directChatV2WriteCoordinator';
import { buildTradeMessageReferenceFromContext, type LinkedTradeContext } from '../../../lib/linkedTradeContext';
import type { ImageAttachmentPreviewState } from '../../../lib/imageAttachmentPreview';
import { parseImageTag } from '../../../lib/imagePull';
import {
  buildMessageWithTradeReferencePayload,
  formatTokenAmount,
  getMessageDisplayText,
  hasInsufficientFundsError,
  IMAGE_MESSAGE_PREFIX,
  isWalletAddress,
  TIP_NATIVE_TOKEN_DECIMALS,
  TIP_NATIVE_TOKEN_SYMBOL,
  trimReplyPreview,
  type ChatMessage,
  type TipTokenSelection
} from '../../../lib/appShared';

type StateSetter<T> = (next: T | ((previous: T) => T)) => void;

type UseDirectMessageActionsArgs = {
  activeContact: string | null;
  activeContactRef: MutableRefObject<string | null>;
  activeLinkedTradeContext: LinkedTradeContext | null;
  clearImageAttachmentStatus: () => void;
  currentWalletKeyRef: MutableRefObject<string>;
  directMessageMaxLength: number;
  directChatV2WriteCoordinator: DirectChatV2WriteCoordinator | null;
  getDirectChatV2ImageSessionToken: (() => Promise<string>) | null;
  isDirectChatV2WriteScopeCurrent: () => boolean;
  messageInput: string;
  replyingToMessage: ChatMessage | null;
  requestChainWhisperFundingAfterError: (message: string) => void;
  sendingRef: MutableRefObject<boolean>;
  setError: (next: string) => void;
  setMessageInput: StateSetter<string>;
  setReplyingToMessage: StateSetter<ChatMessage | null>;
  setSending: StateSetter<boolean>;
  setTipAmountInput: StateSetter<string>;
  setTipping: StateSetter<boolean>;
  setWalletBalanceRefreshNonce: StateSetter<number>;
  setUploadingImage: StateSetter<boolean>;
  showImageAttachmentStatus: (status: ImageAttachmentPreviewState) => void;
  tipNativeBalanceWei: bigint | null;
  tipping: boolean;
  uploadingImage: boolean;
  walletAddress: string;
};

/** Direct writes are Direct Chat V2-only. ChatGC remains an explicit read-only history source. */
export default function useDirectMessageActions({
  activeContact,
  activeContactRef,
  activeLinkedTradeContext,
  clearImageAttachmentStatus,
  currentWalletKeyRef,
  directMessageMaxLength,
  directChatV2WriteCoordinator,
  getDirectChatV2ImageSessionToken,
  isDirectChatV2WriteScopeCurrent,
  messageInput,
  replyingToMessage,
  requestChainWhisperFundingAfterError,
  sendingRef,
  setError,
  setMessageInput,
  setReplyingToMessage,
  setSending,
  setTipAmountInput,
  setTipping,
  setWalletBalanceRefreshNonce,
  setUploadingImage,
  showImageAttachmentStatus,
  tipNativeBalanceWei,
  tipping,
  uploadingImage,
  walletAddress
}: UseDirectMessageActionsArgs) {
  const sendDirectImageMessage = async (file: File) => {
    const targetContact = activeContact;
    if (!directChatV2WriteCoordinator?.enabled) {
      setError('Direct Chat V2 is unavailable or still initializing. No legacy image message was sent.');
      return;
    }
    if (!getDirectChatV2ImageSessionToken) {
      setError('Encrypted image upload sessions are unavailable for Direct Chat V2.');
      return;
    }
    if (replyingToMessage && !replyingToMessage.directV2) {
      setError('Direct Chat V2 image replies can target only new-protocol messages.');
      return;
    }
    await sendChatImageAttachment({
      clearImageAttachmentStatus,
      conversationTarget: targetContact ?? '',
      failureFallbackMessage: 'Failed to send image.',
      file,
      isTargetCurrent: () =>
        activeContactRef.current === targetContact && isDirectChatV2WriteScopeCurrent(),
      kind: 'direct',
      missingTargetMessage: 'Select a contact first.',
      sendImageTag: async (imageTag) => {
        const txHash = await sendMessage(imageTag, replyingToMessage, undefined, true);
        if (!txHash) throw new Error('Image message transaction was not confirmed.');
        return txHash;
      },
      senderAddress: walletAddress,
      uploadAuthorization: {
        mode: 'session',
        protocol: 'direct-v2',
        token: getDirectChatV2ImageSessionToken
      },
      setError,
      setUploadingImage,
      showImageAttachmentStatus,
      targetChangedMessage: 'Conversation changed while the image was uploading. Please attach the image again.',
      targetMissing: !targetContact,
      uploadingImage
    });
  };

  const sendMessage = async (
    overrideMessageText?: string,
    overrideReplyTarget?: ChatMessage | null,
    directChatV2NativeTip?: bigint,
    allowPreparedImageTag = false
  ) => {
    setError('');
    if (sendingRef.current) return;
    if (!directChatV2WriteCoordinator?.enabled) {
      setError('Direct Chat V2 is unavailable or still initializing. No legacy message was sent.');
      return;
    }

    const plainText = sanitizeOutgoingMessagePlainText(overrideMessageText ?? messageInput).trim();
    if (!plainText) {
      setError('Enter a message first.');
      return;
    }
    if (plainText.length > directMessageMaxLength) {
      setError(`Message is too long (max ${directMessageMaxLength} characters).`);
      return;
    }
    const parsedImageTag = parseImageTag(plainText);
    if (plainText.startsWith(IMAGE_MESSAGE_PREFIX) || (parsedImageTag !== null && !allowPreparedImageTag)) {
      setError('Image messages are disabled for security reasons.');
      return;
    }
    if (!activeContact) {
      setError('Select a contact first.');
      return;
    }

    const requestedWalletAddress = walletAddress.trim();
    const requestedWalletKey = requestedWalletAddress.toLowerCase();
    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress)) {
      setError('Connect a wallet first.');
      return;
    }
    if (directChatV2NativeTip !== undefined && directChatV2NativeTip <= 0n) {
      setError('Native chat tips require an amount above zero.');
      return;
    }

    const contactAddress = activeContact;
    const contactKey = contactAddress.toLowerCase();
    const replyTarget = overrideReplyTarget ?? replyingToMessage;
    if (replyTarget && !replyTarget.directV2) {
      setError('Direct Chat V2 replies can target only messages from the new chat protocol.');
      return;
    }
    const replyAnchorCandidate = replyTarget ? getChatReplySourceAnchor(replyTarget) : null;
    if (replyTarget && !replyAnchorCandidate) {
      setError('Direct Chat V2 could not authenticate the reply target.');
      return;
    }
    const replyToMessageAnchor = replyAnchorCandidate ?? undefined;
    const replyingPreviewText = replyTarget ? getMessageDisplayText(replyTarget.text) : undefined;
    const linkedTradeReference = typeof overrideMessageText === 'undefined' && activeLinkedTradeContext
      ? buildTradeMessageReferenceFromContext(activeLinkedTradeContext)
      : undefined;
    const plainTextWithMetadata = buildMessageWithTradeReferencePayload(plainText, linkedTradeReference);
    const localMessageId = `local-direct-v2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const scopeCurrent = () =>
      isDirectChatV2WriteScopeCurrent() &&
      currentWalletKeyRef.current === requestedWalletKey &&
      activeContactRef.current?.toLowerCase() === contactKey;

    try {
      sendingRef.current = true;
      setSending(true);
      const result = await directChatV2WriteCoordinator.send({
        peer: contactAddress,
        payload: {
          body: plainTextWithMetadata,
          ...(replyTarget?.directV2 ? { replyToMessageId: BigInt(replyTarget.directV2.messageId) } : {}),
          ...(replyToMessageAnchor ? { replyToMessageAnchor } : {}),
          ...(replyingPreviewText ? { replyPreview: trimReplyPreview(replyingPreviewText) } : {}),
          ...(directChatV2NativeTip === undefined ? {} : { tip: directChatV2NativeTip })
        },
        optimisticMessage: {
          id: localMessageId,
          direction: 'outgoing',
          text: plainText,
          senderAddress: requestedWalletAddress,
          accountAddress: requestedWalletAddress,
          accountRole: 'owner',
          replyToMessageId: replyTarget?.id,
          replyToMessageAnchor,
          replyToText: replyingPreviewText ? trimReplyPreview(replyingPreviewText) : undefined,
          tradeReference: linkedTradeReference,
          timestamp: Math.floor(Date.now() / 1000),
          deliveryState: 'pending'
        },
        shouldContinue: scopeCurrent
      });
      if (scopeCurrent()) {
        if (typeof overrideMessageText === 'undefined') setMessageInput('');
        setReplyingToMessage(null);
      }
      return result.transactionHash || undefined;
    } catch (sendError) {
      if (scopeCurrent()) {
        const message = getOnChainFailureMessage(
          sendError,
          'Failed to send message.'
        );
        setError(message);
        if (hasInsufficientFundsError(message)) requestChainWhisperFundingAfterError(message);
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const preflightDirectMessageSend = useCallback((_messageText: string, _replyTarget?: ChatMessage | null) => {
    if (directChatV2WriteCoordinator?.enabled) return true;
    setError('Direct Chat V2 is unavailable or still initializing. No legacy message was sent.');
    return false;
  }, [directChatV2WriteCoordinator?.enabled, setError]);

  const sendTipToActiveContact = async (tipToken: TipTokenSelection, tipAmount: bigint) => {
    if (!directChatV2WriteCoordinator?.enabled) {
      setError('Direct Chat V2 is unavailable or still initializing. No legacy tip was sent.');
      return;
    }
    if (!activeContact || !isWalletAddress(activeContact)) {
      setError('Select a valid contact first.');
      return;
    }
    if (tipToken !== 'coti') {
      setError('Direct Chat V2 currently supports native COTI tips only.');
      return;
    }
    if (tipAmount <= 0n) {
      setError('Enter a tip amount above zero.');
      return;
    }
    if (tipNativeBalanceWei === null) {
      setError('Unable to read COTI balance. Wait for balances to load and try again.');
      return;
    }
    if (tipAmount > tipNativeBalanceWei) {
      setError(
        `Insufficient COTI balance. Available ${formatTokenAmount(tipNativeBalanceWei, TIP_NATIVE_TOKEN_DECIMALS, 6)} COTI.`
      );
      return;
    }
    if (tipping) return;

    try {
      setTipping(true);
      const tipNoticeText = `[TIP] You received ${formatTokenAmount(
        tipAmount,
        TIP_NATIVE_TOKEN_DECIMALS,
        TIP_NATIVE_TOKEN_DECIMALS
      )} ${TIP_NATIVE_TOKEN_SYMBOL}.`;
      const transactionHash = await sendMessage(tipNoticeText, null, tipAmount);
      if (transactionHash) {
        setTipAmountInput('');
        setWalletBalanceRefreshNonce((previous) => previous + 1);
      }
    } finally {
      setTipping(false);
    }
  };

  const sendTipToActiveGroupMember = async (_tipToken: TipTokenSelection, _tipAmount: bigint) => {
    setError('Open a direct chat with this member to send a Chat V2 tip.');
  };

  return {
    preflightDirectMessageSend,
    sendDirectImageMessage,
    sendMessage,
    sendTipToActiveContact,
    sendTipToActiveGroupMember
  };
}
