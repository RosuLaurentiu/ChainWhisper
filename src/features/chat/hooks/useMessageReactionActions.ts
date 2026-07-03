import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import {
  buildMessageReferenceKeys,
  getOnChainFailureMessage
} from '../../../lib/appHelpers';
import { submitDirectMemo } from '../../../lib/directChatChain';
import { submitGroupMemo } from '../../../lib/groupChatChain';
import {
  buildMessageWithReactionPayload,
  getGroupActionErrorMessage,
  hasInsufficientFundsError,
  isWalletAddress,
  mergeOnboardInfo,
  normalizeReactionEmoji,
  type ChatMessage,
  type GroupFeeModeSelection,
  type SignerSource,
  type SyncConversationOptions,
  type SyncGroupOptions
} from '../../../lib/appShared';

type StateSetter<T> = (next: T | ((previous: T) => T)) => void;

type MemoSignerBundle = {
  signer: Wallet | JsonRpcSigner;
  cacheKey: string;
};

type ReactionSummary = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
};

type UseMessageReactionActionsArgs = {
  activeContact: string | null;
  activeGroupId: number | null;
  activeSignerSource: SignerSource;
  activeThreadMessageReferenceLookup: Map<string, string>;
  activeThreadReactions: Map<string, ReactionSummary[]>;
  browserWalletLiteMode: boolean;
  currentWalletKeyRef: MutableRefObject<string>;
  encodeMemoForActiveSigner: (plain: string) => string;
  getMemoSigner: () => Promise<MemoSignerBundle>;
  groupFeeModeSelection: GroupFeeModeSelection;
  privateRewardTokenBalanceWei: bigint | null;
  requestChainWhisperFundingAfterError: (message: string) => void;
  resolveGroupSubmitSelector: () => Promise<string>;
  resolveRequiredFeeForGroupSend: () => Promise<bigint>;
  resolveRequiredFeeForSend: () => Promise<bigint>;
  resolveRequiredTokenFeeForGroupSend: () => Promise<bigint>;
  resolveSubmitSelector: () => Promise<string>;
  runWalletTransactionFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  sendingReaction: boolean;
  setError: (next: string) => void;
  setMessagesByContact: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
  setMessagesByGroup: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
  setReactionPickerMessageId: StateSetter<string | null>;
  setSendingReaction: StateSetter<boolean>;
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  setTopUpMetricsNonce: StateSetter<number>;
  syncConversationHistory: (options?: SyncConversationOptions) => Promise<void>;
  syncGroupData: (options?: SyncGroupOptions) => Promise<void>;
  walletAddress: string;
};

export default function useMessageReactionActions({
  activeContact,
  activeGroupId,
  activeSignerSource,
  activeThreadMessageReferenceLookup,
  activeThreadReactions,
  browserWalletLiteMode,
  currentWalletKeyRef,
  encodeMemoForActiveSigner,
  getMemoSigner,
  groupFeeModeSelection,
  privateRewardTokenBalanceWei,
  requestChainWhisperFundingAfterError,
  resolveGroupSubmitSelector,
  resolveRequiredFeeForGroupSend,
  resolveRequiredFeeForSend,
  resolveRequiredTokenFeeForGroupSend,
  resolveSubmitSelector,
  runWalletTransactionFlow,
  sendingReaction,
  setError,
  setMessagesByContact,
  setMessagesByGroup,
  setReactionPickerMessageId,
  setSendingReaction,
  setSessionOnboardInfo,
  setTopUpMetricsNonce,
  syncConversationHistory,
  syncGroupData,
  walletAddress
}: UseMessageReactionActionsArgs) {
  const sendReactionToMessage = async (targetMessage: ChatMessage, emojiInput: string) => {
    setError('');

    if (browserWalletLiteMode) {
      setError('Use the ChainWhisper account to send reactions.');
      return;
    }

    if (sendingReaction) {
      return;
    }

    const normalizedEmoji = normalizeReactionEmoji(emojiInput);
    if (!normalizedEmoji) {
      setError('Choose a valid emoji reaction.');
      return;
    }

    const targetTxHash = targetMessage.txHash?.trim().toLowerCase() ?? '';
    const targetReferenceKeyCandidates = buildMessageReferenceKeys({
      txHash: targetMessage.txHash,
      blockNumber: targetMessage.blockNumber,
      logIndex: targetMessage.logIndex
    });
    if (targetReferenceKeyCandidates.length === 0) {
      setError('Wait for the message to confirm on-chain before adding a reaction.');
      return;
    }

    const targetReferenceKey =
      targetReferenceKeyCandidates.map((key) => activeThreadMessageReferenceLookup.get(key)).find(Boolean) ??
      targetReferenceKeyCandidates[0] ??
      '';
    const existingReactions = targetReferenceKey ? activeThreadReactions.get(targetReferenceKey) ?? [] : [];
    const alreadyReactedWithEmoji = existingReactions.some(
      (reaction) => reaction.emoji === normalizedEmoji && reaction.reactedByMe
    );
    if (alreadyReactedWithEmoji) {
      setError('You already sent this reaction.');
      return;
    }

    const requestedWalletAddress = walletAddress.trim();
    const requestedWalletKey = requestedWalletAddress.toLowerCase();
    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress)) {
      setError('Connect a wallet first.');
      return;
    }

    const threadGroupId = activeGroupId;
    const threadContactAddress = activeContact;
    if (threadGroupId === null && !threadContactAddress) {
      setError('Open a chat first.');
      return;
    }

    const localMessageId =
      threadGroupId !== null
        ? `local-group-reaction-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
        : `local-reaction-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const localMessageTimestamp = Math.floor(Date.now() / 1000);
    const reactionMemoText = buildMessageWithReactionPayload(
      targetTxHash,
      normalizedEmoji,
      '',
      targetMessage.blockNumber,
      targetMessage.logIndex,
      threadGroupId !== null
    );

    try {
      setSendingReaction(true);
      setReactionPickerMessageId(null);

      await runWalletTransactionFlow(async () => {
        if (threadGroupId !== null) {
          const groupKey = String(threadGroupId);
          setMessagesByGroup((previous) => ({
            ...previous,
            [groupKey]: [
              ...(previous[groupKey] ?? []),
              {
                id: localMessageId,
                direction: 'outgoing',
                text: '',
                senderAddress: requestedWalletAddress,
                reactionToTxHash: targetTxHash,
                reactionToBlockNumber: targetMessage.blockNumber,
                reactionToLogIndex: targetMessage.logIndex,
                reactionEmoji: normalizedEmoji,
                timestamp: localMessageTimestamp,
                deliveryState: 'pending'
              }
            ]
          }));

          const { signer, cacheKey } = await getMemoSigner();
          const selector = await resolveGroupSubmitSelector();
          const paymentMode = groupFeeModeSelection === 'token' ? 1 : 0;
          const requiredFee = paymentMode === 0 ? await resolveRequiredFeeForGroupSend() : 0n;
          const requiredTokenFee = paymentMode === 1 ? await resolveRequiredTokenFeeForGroupSend() : 0n;
          const submittedTx = await submitGroupMemo({
            signer,
            groupId: threadGroupId,
            plainText: reactionMemoText,
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

          await syncGroupData({ background: true, activeMessagesOnly: true });
        } else if (threadContactAddress) {
          const contactKey = threadContactAddress.toLowerCase();
          setMessagesByContact((previous) => ({
            ...previous,
            [contactKey]: [
              ...(previous[contactKey] ?? []),
              {
                id: localMessageId,
                direction: 'outgoing',
                text: '',
                senderAddress: requestedWalletAddress,
                reactionToTxHash: targetTxHash,
                reactionToBlockNumber: targetMessage.blockNumber,
                reactionToLogIndex: targetMessage.logIndex,
                reactionEmoji: normalizedEmoji,
                timestamp: localMessageTimestamp,
                deliveryState: 'pending'
              }
            ]
          }));

          const { signer, cacheKey } = await getMemoSigner();
          const selector = await resolveSubmitSelector();
          const requiredFee = await resolveRequiredFeeForSend();
          const submittedTx = await submitDirectMemo({
            signer,
            contactAddress: threadContactAddress,
            plainText: reactionMemoText,
            selector,
            requiredFee,
            encodeMemo: encodeMemoForActiveSigner
          });
          const submittedTxHash = submittedTx.txHash;

          if (currentWalletKeyRef.current !== requestedWalletKey) {
            return;
          }

          setMessagesByContact((previous) => ({
            ...previous,
            [contactKey]: (previous[contactKey] ?? []).map((message) =>
              message.id === localMessageId ? { ...message, txHash: submittedTxHash || undefined } : message
            )
          }));

          const receipt = await submittedTx.wait();
          if (!receipt || Number((receipt as { status?: number | bigint }).status ?? 0) !== 1) {
            throw new Error('Transaction failed on-chain.');
          }

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

          syncConversationHistory({ background: true, activeContactOnly: true }).catch(() => {});
        }

        if (activeSignerSource === 'burner') {
          setTopUpMetricsNonce((previous) => previous + 1);
        }
      });
    } catch (reactionError) {
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const message =
        threadGroupId !== null
          ? getGroupActionErrorMessage(reactionError, getOnChainFailureMessage(reactionError, 'Failed to send reaction.'))
          : reactionError instanceof Error
            ? getOnChainFailureMessage(reactionError, reactionError.message)
            : getOnChainFailureMessage(reactionError, 'Failed to send reaction.');
      setError(message);

      if (threadGroupId !== null) {
        const groupKey = String(threadGroupId);
        setMessagesByGroup((previous) => ({
          ...previous,
          [groupKey]: (previous[groupKey] ?? []).map((messageRecord) =>
            messageRecord.id === localMessageId ? { ...messageRecord, deliveryState: 'failed' } : messageRecord
          )
        }));
      } else if (threadContactAddress) {
        const contactKey = threadContactAddress.toLowerCase();
        setMessagesByContact((previous) => ({
          ...previous,
          [contactKey]: (previous[contactKey] ?? []).map((messageRecord) =>
            messageRecord.id === localMessageId ? { ...messageRecord, deliveryState: 'failed' } : messageRecord
          )
        }));
      }

      if (activeSignerSource === 'burner' && hasInsufficientFundsError(message)) {
        requestChainWhisperFundingAfterError(message);
      }
    } finally {
      setSendingReaction(false);
    }
  };

  return { sendReactionToMessage };
}
