import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import {
  getOnChainFailureMessage,
  messageReferencesMatch,
  sanitizeOutgoingMessagePlainText
} from '../../../lib/appHelpers';
import { sendChatImageAttachment } from '../../../lib/chatImageAttachment';
import {
  buildMetaMaskPromptEstimateMessage,
  estimateChatWalletPromptLoad
} from '../../../lib/chatWalletPromptEstimate';
import { submitDirectMemo } from '../../../lib/directChatChain';
import { buildTradeMessageReferenceFromContext, type LinkedTradeContext } from '../../../lib/linkedTradeContext';
import type { ImageAttachmentPreviewState } from '../../../lib/imageAttachmentPreview';
import {
  buildMessageWithReplyPayload,
  buildMessageWithTradeReferencePayload,
  CHAT_CONTRACT_ABI,
  CHAT_CONTRACT_ADDRESS,
  encodeCompactMemoPlaintext,
  ERC20_TOKEN_ABI,
  formatTokenAmount,
  getMessageDisplayText,
  hasInsufficientFundsError,
  IMAGE_MESSAGE_PREFIX,
  isWalletAddress,
  loadCotiEthersModule,
  mergeOnboardInfo,
  parseSubmitMemoPayload,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  TIP_NATIVE_TOKEN_DECIMALS,
  TIP_NATIVE_TOKEN_SYMBOL,
  trimReplyPreview,
  type ChatMessage,
  type SignerSource,
  type SyncConversationOptions,
  type TipTokenSelection
} from '../../../lib/appShared';
import {
  resolveConversationActionAccount,
  type WalletReadAccount
} from '../../../lib/walletAccountScope';

type StateSetter<T> = (next: T | ((previous: T) => T)) => void;

type MemoSignerBundle = {
  signer: Wallet | JsonRpcSigner;
  cacheKey: string;
};

type UseDirectMessageActionsArgs = {
  activeContact: string | null;
  activeContactRef: MutableRefObject<string | null>;
  activeLinkedTradeContext: LinkedTradeContext | null;
  activeMessages: ChatMessage[];
  activeSignerSource: SignerSource;
  browserWalletLiteMode: boolean;
  clearImageAttachmentStatus: () => void;
  currentWalletKeyRef: MutableRefObject<string>;
  directMessageMaxLength: number;
  encodeMemoForActiveSigner: (plain: string) => string;
  getMemoSigner: () => Promise<MemoSignerBundle>;
  getMemoSignerForAccount: (account: WalletReadAccount) => Promise<MemoSignerBundle>;
  groupTipRecipientAddress: string;
  messageInput: string;
  privateRewardTokenBalanceWei: bigint | null;
  privateRewardTokenDecimals: number;
  privateRewardTokenSymbol: string;
  replyingToMessage: ChatMessage | null;
  requestChainWhisperFundingAfterError: (message: string) => void;
  resolveRequiredFeeForSend: () => Promise<bigint>;
  resolveSubmitSelector: () => Promise<string>;
  rewardTokenBalanceWei: bigint | null;
  rewardTokenDecimals: number;
  rewardTokenSymbol: string;
  runWalletTransactionFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  sendingRef: MutableRefObject<boolean>;
  setError: (next: string) => void;
  setMessageInput: StateSetter<string>;
  setMessagesByContact: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
  setPrivateRewardTokenBalanceWei: StateSetter<bigint | null>;
  setReplyingToMessage: StateSetter<ChatMessage | null>;
  setRewardTokenBalanceWei: StateSetter<bigint | null>;
  setSending: StateSetter<boolean>;
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  setTipAmountInput: StateSetter<string>;
  setTipNativeBalanceWei: StateSetter<bigint | null>;
  setTipping: StateSetter<boolean>;
  setTopUpMetricsNonce: StateSetter<number>;
  setUploadingImage: StateSetter<boolean>;
  showImageAttachmentStatus: (status: ImageAttachmentPreviewState) => void;
  syncConversationHistory: (options?: SyncConversationOptions) => Promise<void>;
  tipNativeBalanceWei: bigint | null;
  tipping: boolean;
  uploadingImage: boolean;
  walletAddress: string;
  walletReadAccounts: WalletReadAccount[];
};

export default function useDirectMessageActions({
  activeContact,
  activeContactRef,
  activeLinkedTradeContext,
  activeMessages,
  activeSignerSource,
  browserWalletLiteMode,
  clearImageAttachmentStatus,
  currentWalletKeyRef,
  directMessageMaxLength,
  encodeMemoForActiveSigner,
  getMemoSigner,
  getMemoSignerForAccount,
  groupTipRecipientAddress,
  messageInput,
  privateRewardTokenBalanceWei,
  privateRewardTokenDecimals,
  privateRewardTokenSymbol,
  replyingToMessage,
  requestChainWhisperFundingAfterError,
  resolveRequiredFeeForSend,
  resolveSubmitSelector,
  rewardTokenBalanceWei,
  rewardTokenDecimals,
  rewardTokenSymbol,
  runWalletTransactionFlow: runSharedWalletTransactionFlow,
  sendingRef,
  setError,
  setMessageInput,
  setMessagesByContact,
  setPrivateRewardTokenBalanceWei,
  setReplyingToMessage,
  setRewardTokenBalanceWei,
  setSending,
  setSessionOnboardInfo,
  setTipAmountInput,
  setTipNativeBalanceWei,
  setTipping,
  setTopUpMetricsNonce,
  setUploadingImage,
  showImageAttachmentStatus,
  syncConversationHistory,
  tipNativeBalanceWei,
  tipping,
  uploadingImage,
  walletAddress,
  walletReadAccounts
}: UseDirectMessageActionsArgs) {
  const resolveSelectedDirectAccount = (replyTarget?: ChatMessage | null) =>
    resolveConversationActionAccount({
      fallbackAddress: walletAddress,
      messages: activeMessages,
      readAccounts: walletReadAccounts,
      replyTarget
    });

  const sendDirectImageMessage = async (file: File) => {
    const targetContact = activeContact;
    const replyTarget = browserWalletLiteMode ? null : replyingToMessage;
    const selectedAccount = resolveSelectedDirectAccount(replyTarget);
    await sendChatImageAttachment({
      clearImageAttachmentStatus,
      failureFallbackMessage: 'Failed to send image.',
      file,
      isTargetCurrent: () => activeContactRef.current === targetContact,
      kind: 'direct',
      missingTargetMessage: 'Select a contact first.',
      sendImageTag: async (imageTag) => {
        const txHash = await sendMessage(imageTag, replyTarget);
        if (!txHash) {
          throw new Error('Image message transaction was not confirmed.');
        }
        return txHash;
      },
      senderAddress: selectedAccount?.address ?? walletAddress,
      setError,
      setUploadingImage,
      showImageAttachmentStatus,
      targetChangedMessage: 'Conversation changed while the image was uploading. Please attach the image again.',
      targetMissing: !targetContact,
      uploadingImage
    });
  };

  const sendMessage = async (overrideMessageText?: string, overrideReplyTarget?: ChatMessage | null) => {
    setError('');

    if (sendingRef.current) {
      return;
    }

    const plainText = sanitizeOutgoingMessagePlainText(overrideMessageText ?? messageInput).trim();
    if (!plainText) {
      setError('Enter a message first.');
      return;
    }

    if (plainText.length > directMessageMaxLength) {
      setError(
        browserWalletLiteMode
          ? `Message is too long for MetaMask mode (max ${directMessageMaxLength} characters).`
          : `Message is too long (max ${directMessageMaxLength} characters).`
      );
      return;
    }

    if (plainText.startsWith(IMAGE_MESSAGE_PREFIX)) {
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

    const contactAddress = activeContact;
    const contactKey = contactAddress.toLowerCase();
    const replyTarget = browserWalletLiteMode ? null : overrideReplyTarget ?? replyingToMessage;
    const selectedAccount = resolveSelectedDirectAccount(replyTarget);
    if (!selectedAccount?.address) {
      setError('Connect a wallet first.');
      return;
    }
    const selectedAccountKey = selectedAccount.key || selectedAccount.address.toLowerCase();
    const selectedEncodeMemo =
      selectedAccount.role === 'owner' ? encodeCompactMemoPlaintext : encodeMemoForActiveSigner;
    const replyingPreviewText = replyTarget ? getMessageDisplayText(replyTarget.text) : undefined;
    const linkedTradeReference =
      typeof overrideMessageText === 'undefined' && activeLinkedTradeContext
        ? buildTradeMessageReferenceFromContext(activeLinkedTradeContext)
        : undefined;
    const plainTextWithReply = buildMessageWithReplyPayload(
      plainText,
      replyingPreviewText,
      replyTarget?.txHash,
      replyTarget?.blockNumber,
      replyTarget?.logIndex,
      false
    );
    const plainTextWithMetadata = buildMessageWithTradeReferencePayload(plainTextWithReply, linkedTradeReference);
    const selectedUsesBrowserPrompt = activeSignerSource === 'metamask' || selectedAccount.role === 'owner';
    if (selectedUsesBrowserPrompt) {
      const promptEstimate = estimateChatWalletPromptLoad(plainTextWithMetadata, encodeCompactMemoPlaintext);
      if (promptEstimate.likelyMultipart) {
        const estimateSubject = linkedTradeReference
          ? `this message with Trade #${linkedTradeReference.tradeId} reference`
          : 'this message';
        setError(buildMetaMaskPromptEstimateMessage(promptEstimate, estimateSubject));
        return;
      }
    }

    const localMessageId = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const localMessageTimestamp = Math.floor(Date.now() / 1000);
    let confirmedTxHash = '';

    try {
      sendingRef.current = true;
      setSending(true);
      setMessagesByContact((previous) => ({
        ...previous,
        [contactKey]: [
          ...(previous[contactKey] ?? []),
          {
            id: localMessageId,
            direction: 'outgoing',
            text: plainText,
            senderAddress: selectedAccount.address,
            accountAddress: selectedAccount.address,
            accountRole: selectedAccount.role,
            replyToMessageId: replyTarget?.id,
            replyToText: replyingPreviewText ? trimReplyPreview(replyingPreviewText) : undefined,
            replyToTxHash: replyTarget?.txHash,
            replyToBlockNumber: replyTarget?.blockNumber,
            replyToLogIndex: replyTarget?.logIndex,
            tradeReference: linkedTradeReference,
            timestamp: localMessageTimestamp,
            deliveryState: 'pending'
          }
        ]
      }));

      await runSharedWalletTransactionFlow(async () => {
      const { signer, cacheKey } =
        selectedAccountKey === requestedWalletKey
          ? await getMemoSigner()
          : await getMemoSignerForAccount(selectedAccount);
      const selector = await resolveSubmitSelector();
      const requiredFee = await resolveRequiredFeeForSend();
      const submittedTx = await submitDirectMemo({
        signer,
        contactAddress,
        plainText: plainTextWithMetadata,
        selector,
        requiredFee,
        encodeMemo: selectedEncodeMemo,
        allowMultipart: !selectedUsesBrowserPrompt
      });
      const submittedTxHash = submittedTx.txHash;
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      setMessagesByContact((previous) => {
        const existing = previous[contactKey] ?? [];
        const normalizedSubmittedTxHash = submittedTxHash.trim().toLowerCase();
        const hasConfirmedTwinByTxHash =
          normalizedSubmittedTxHash.length > 0 &&
          existing.some(
            (message) =>
              !message.id.startsWith('local-') &&
              message.direction === 'outgoing' &&
              typeof message.txHash === 'string' &&
              message.txHash.toLowerCase() === normalizedSubmittedTxHash
          );

        const localMessageRecord = existing.find((message) => message.id === localMessageId);
        const hasConfirmedTwinByContent =
          !hasConfirmedTwinByTxHash &&
          Boolean(
            localMessageRecord &&
              existing.some((message) => {
                if (message.id.startsWith('local-') || message.direction !== 'outgoing') {
                  return false;
                }
                return (
                  message.text === localMessageRecord.text &&
                  (message.replyToText ?? '') === (localMessageRecord.replyToText ?? '') &&
                  (message.tradeReference?.tradeId ?? 0) === (localMessageRecord.tradeReference?.tradeId ?? 0) &&
                  (message.tradeReference?.escrowContract ?? '').toLowerCase() ===
                    (localMessageRecord.tradeReference?.escrowContract ?? '').toLowerCase() &&
                  (message.tradeReference?.terminalPath ?? '') ===
                    (localMessageRecord.tradeReference?.terminalPath ?? '') &&
                  messageReferencesMatch(
                    {
                      txHash: message.replyToTxHash,
                      blockNumber: message.replyToBlockNumber,
                      logIndex: message.replyToLogIndex
                    },
                    {
                      txHash: localMessageRecord.replyToTxHash,
                      blockNumber: localMessageRecord.replyToBlockNumber,
                      logIndex: localMessageRecord.replyToLogIndex
                    }
                  )
                );
              })
          );

        if (hasConfirmedTwinByTxHash || hasConfirmedTwinByContent) {
          return {
            ...previous,
            [contactKey]: existing.filter((message) => message.id !== localMessageId)
          };
        }

        return {
          ...previous,
          [contactKey]: existing.map((message) =>
            message.id === localMessageId
              ? {
                  ...message,
                  txHash: submittedTxHash || undefined
                }
              : message
          )
        };
      });

      const receipt = await submittedTx.wait();
      if (
        !receipt ||
        Number((receipt as { status?: number | bigint }).status ?? 0) !== 1
      ) {
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

      setMessagesByContact((previous) => ({
        ...previous,
        [contactKey]: (previous[contactKey] ?? []).map((message) =>
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
      syncConversationHistory({ background: true, activeContactOnly: true }).catch(() => {});
      if (activeSignerSource === 'burner' && selectedAccount.isActionAccount) {
        setTopUpMetricsNonce((previous) => previous + 1);
      }
      });
    } catch (sendError) {
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }
      const message =
        sendError instanceof Error
          ? getOnChainFailureMessage(sendError, sendError.message)
          : getOnChainFailureMessage(sendError, 'Failed to send message.');
      setError(message);
      setMessagesByContact((previous) => ({
        ...previous,
        [contactKey]: (previous[contactKey] ?? []).map((messageRecord) =>
          messageRecord.id === localMessageId
            ? {
                ...messageRecord,
                deliveryState: 'failed'
              }
            : messageRecord
        )
      }));

      if (activeSignerSource === 'burner' && selectedAccount.isActionAccount && hasInsufficientFundsError(message)) {
        requestChainWhisperFundingAfterError(message);
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
    return confirmedTxHash || undefined;
  };

  const preflightDirectMessageSend = useCallback(
    (messageText: string, overrideReplyTarget?: ChatMessage | null): boolean => {
      if (activeSignerSource !== 'metamask') {
        return true;
      }

      const plainText = sanitizeOutgoingMessagePlainText(messageText).trim();
      const replyTarget = browserWalletLiteMode ? null : overrideReplyTarget ?? null;
      const replyingPreviewText = replyTarget ? getMessageDisplayText(replyTarget.text) : undefined;
      const plainTextWithReply = buildMessageWithReplyPayload(
        plainText,
        replyingPreviewText,
        replyTarget?.txHash,
        replyTarget?.blockNumber,
        replyTarget?.logIndex,
        false
      );
      const estimate = estimateChatWalletPromptLoad(plainTextWithReply, encodeCompactMemoPlaintext);
      if (!estimate.likelyMultipart) {
        return true;
      }

      setError(buildMetaMaskPromptEstimateMessage(estimate, 'the trade notification'));
      return false;
    },
    [activeSignerSource, browserWalletLiteMode, setError]
  );

  const sendTipToRecipient = async (
    recipientInput: string,
    tipToken: TipTokenSelection,
    tipAmount: bigint,
    options?: {
      missingRecipientMessage?: string;
      invalidRecipientMessage?: string;
    }
  ) => {
    setError('');

    if (sendingRef.current || tipping) {
      return;
    }

    const recipient = recipientInput.trim();
    if (!recipient) {
      setError(options?.missingRecipientMessage ?? 'Select a recipient first.');
      return;
    }

    if (!isWalletAddress(recipient)) {
      setError(options?.invalidRecipientMessage ?? 'Invalid recipient address.');
      return;
    }

    if (walletAddress && recipient.toLowerCase() === walletAddress.toLowerCase()) {
      setError('Cannot tip your own wallet.');
      return;
    }

    if (tipAmount <= 0n) {
      setError('Enter a tip amount above zero.');
      return;
    }

    const tokenAddress = tipToken === 'wisp' ? REWARD_TOKEN_ADDRESS : PRIVATE_REWARD_TOKEN_ADDRESS;
    const tokenSymbol =
      tipToken === 'coti'
        ? TIP_NATIVE_TOKEN_SYMBOL
        : tipToken === 'wisp'
          ? rewardTokenSymbol
          : privateRewardTokenSymbol;
    const tokenDecimals =
      tipToken === 'coti'
        ? TIP_NATIVE_TOKEN_DECIMALS
        : tipToken === 'wisp'
          ? rewardTokenDecimals
          : privateRewardTokenDecimals;
    const tokenBalanceWei =
      tipToken === 'coti' ? tipNativeBalanceWei : tipToken === 'wisp' ? rewardTokenBalanceWei : privateRewardTokenBalanceWei;

    if (tokenBalanceWei === null) {
      setError(`Unable to read ${tokenSymbol} balance. Wait for balances to load and try again.`);
      return;
    }

    if (tipAmount > tokenBalanceWei) {
      setError(
        `Insufficient ${tokenSymbol} balance. Available ${formatTokenAmount(tokenBalanceWei, tokenDecimals, 6)} ${tokenSymbol}.`
      );
      return;
    }

    let transferSucceeded = false;
    try {
      setTipping(true);
      await runSharedWalletTransactionFlow(async () => {
      const { signer, cacheKey } = await getMemoSigner();
      const cotiEthers = await loadCotiEthersModule();
      let requiredFeeForTipNotice: bigint | null = null;

      if (tipToken === 'coti') {
        requiredFeeForTipNotice = await resolveRequiredFeeForSend();
        if (tokenBalanceWei < tipAmount + requiredFeeForTipNotice) {
          throw new Error(
            `Insufficient COTI balance. Keep at least ${formatTokenAmount(requiredFeeForTipNotice, TIP_NATIVE_TOKEN_DECIMALS, 6)} COTI for the tip note fee.`
          );
        }
      } else {
        const tipTokenContract = new cotiEthers.Contract(tokenAddress, ERC20_TOKEN_ABI, signer);
        const tx = await tipTokenContract.transfer(recipient, tipAmount);
        await tx.wait();
        transferSucceeded = true;
      }

      setTopUpMetricsNonce((previous) => previous + 1);
      if (tipToken === 'wisp') {
        setRewardTokenBalanceWei((previous) =>
          previous === null ? previous : previous > tipAmount ? previous - tipAmount : 0n
        );
      } else {
        setPrivateRewardTokenBalanceWei((previous) =>
          previous === null ? previous : previous > tipAmount ? previous - tipAmount : 0n
        );
      }

      const selector = await resolveSubmitSelector();
      const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, signer);
      const requiredFee = requiredFeeForTipNotice ?? (await resolveRequiredFeeForSend());
      const tipNoticeText = `[TIP] You received ${formatTokenAmount(tipAmount, tokenDecimals, 6)} ${tokenSymbol}.`;
      const encodedTipMemo = encodeMemoForActiveSigner(tipNoticeText);
      const encryptedTipMemo = await signer.encryptValue(encodedTipMemo, CHAT_CONTRACT_ADDRESS, selector);
      const submitTipMemoPayload = parseSubmitMemoPayload(encryptedTipMemo);
      const tipMemoTuple = [[submitTipMemoPayload.ciphertextValue], submitTipMemoPayload.signature] as const;
      const nativeValue = tipToken === 'coti' ? requiredFee + tipAmount : requiredFee;
      const tipMemoTx = await contract.submit(recipient, tipMemoTuple, { value: nativeValue });
      await tipMemoTx.wait();
      if (tipToken === 'coti') {
        setTipNativeBalanceWei((previous) =>
          previous === null ? previous : previous > nativeValue ? previous - nativeValue : 0n
        );
      }

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));
      syncConversationHistory({ background: true, activeContactOnly: true }).catch(() => {});
      setTipAmountInput('');
      });
    } catch (tipError) {
      const rawMessage = tipError instanceof Error ? tipError.message : '';
      const message = rawMessage || (transferSucceeded ? 'Tip sent, but notification message failed.' : 'Failed to send tip.');
      setError(transferSucceeded ? `Tip sent, but notification failed: ${message}` : message);
      if (activeSignerSource === 'burner' && hasInsufficientFundsError(message)) {
        requestChainWhisperFundingAfterError(message);
      }
    } finally {
      setTipping(false);
    }
  };

  const sendTipToActiveContact = async (
    tipToken: TipTokenSelection,
    tipAmount: bigint
  ) => {
    await sendTipToRecipient(activeContact ?? '', tipToken, tipAmount, {
      missingRecipientMessage: 'Select a contact first.',
      invalidRecipientMessage: 'Invalid contact address.'
    });
  };

  const sendTipToActiveGroupMember = async (
    tipToken: TipTokenSelection,
    tipAmount: bigint
  ) => {
    await sendTipToRecipient(groupTipRecipientAddress, tipToken, tipAmount, {
      missingRecipientMessage: 'Select a group member first.',
      invalidRecipientMessage: 'Invalid group member address.'
    });
  };

  return {
    preflightDirectMessageSend,
    sendDirectImageMessage,
    sendMessage,
    sendTipToActiveContact,
    sendTipToActiveGroupMember,
    sendTipToRecipient
  };
}
