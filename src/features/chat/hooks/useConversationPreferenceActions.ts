import type { Dispatch, SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import type { SignerSource, SyncConversationOptions } from '../../../lib/appShared';
import {
  ConversationPreferenceState,
  COTI_NETWORK,
  hasInsufficientFundsError,
  isWalletAddress,
  MAX_MESSAGE_LENGTH,
  mergeOnboardInfo,
  normalizeContactName,
  normalizeConversationPreferenceState
} from '../../../lib/appShared';
import {
  submitHiddenContactNameMemo,
  submitHiddenConversationStateMemo
} from '../../../lib/directChatChain';

type StateSetter<T> = (next: T | ((previous: T) => T)) => void;

type MemoSignerBundle = {
  signer: Wallet | JsonRpcSigner;
  cacheKey: string;
};

type UseConversationPreferenceActionsArgs = {
  activeSignerSource: SignerSource;
  browserWalletLiteMode: boolean;
  chainId: number | null;
  encodeMemoForActiveSigner: (plain: string) => string;
  getMemoSigner: () => Promise<MemoSignerBundle>;
  hasAesReady: boolean;
  requestChainWhisperFundingAfterError: (message: string) => void;
  resolveRequiredFeeForSend: () => Promise<bigint>;
  resolveSubmitSelector: () => Promise<string>;
  runWalletTransactionFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  setError: (next: string) => void;
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  setTopUpMetricsNonce: StateSetter<number>;
  syncConversationHistory: (options?: SyncConversationOptions) => Promise<void>;
  walletAddress: string;
};

export default function useConversationPreferenceActions({
  activeSignerSource,
  browserWalletLiteMode,
  chainId,
  encodeMemoForActiveSigner,
  getMemoSigner,
  hasAesReady,
  requestChainWhisperFundingAfterError,
  resolveRequiredFeeForSend,
  resolveSubmitSelector,
  runWalletTransactionFlow,
  setError,
  setSessionOnboardInfo,
  setTopUpMetricsNonce,
  syncConversationHistory,
  walletAddress
}: UseConversationPreferenceActionsArgs) {
  const sendHiddenContactNameToContact = async (contactAddress: string, contactName: string): Promise<string> => {
    const normalizedAddress = contactAddress.trim();
    const normalizedContactName = normalizeContactName(contactName)?.slice(0, 42);
    if (!isWalletAddress(normalizedAddress)) {
      throw new Error('Invalid contact address.');
    }
    if (!normalizedContactName) {
      throw new Error('Contact name cannot be empty.');
    }

    return runWalletTransactionFlow(async () => {
      const { signer, cacheKey } = await getMemoSigner();
      const selector = await resolveSubmitSelector();
      const requiredFee = await resolveRequiredFeeForSend();
      const { txHash } = await submitHiddenContactNameMemo({
        signer,
        contactAddress: normalizedAddress,
        contactName: normalizedContactName,
        selector,
        requiredFee,
        encodeMemo: encodeMemoForActiveSigner
      });

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      return txHash;
    });
  };

  const syncContactNameAliasFromInput = async (contactAddress: string, contactName: string): Promise<void> => {
    if (browserWalletLiteMode) {
      return;
    }

    const normalizedAddress = contactAddress.trim();
    const normalizedContactName = normalizeContactName(contactName)?.slice(0, 42);
    if (!isWalletAddress(normalizedAddress) || !normalizedContactName) {
      return;
    }

    if (!walletAddress || !hasAesReady || chainId !== COTI_NETWORK.chainIdDecimal) {
      return;
    }

    if (normalizedAddress.toLowerCase() === walletAddress.toLowerCase()) {
      return;
    }

    try {
      await sendHiddenContactNameToContact(normalizedAddress, normalizedContactName);
      syncConversationHistory({
        contactsOnly: true,
        previewPerContact: true,
        updateHead: true
      }).catch(() => {});
      setTopUpMetricsNonce((previous) => previous + 1);
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : 'Failed to sync contact name alias.';
      setError(`Saved locally, but alias sync failed: ${message}`);
      if (activeSignerSource === 'burner' && hasInsufficientFundsError(message)) {
        requestChainWhisperFundingAfterError(message);
      }
    }
  };

  const sendHiddenConversationStateToContact = async (
    contactAddress: string,
    state: ConversationPreferenceState,
    visibleNotice = ''
  ): Promise<string> => {
    const normalizedAddress = contactAddress.trim();
    const normalizedState = normalizeConversationPreferenceState(state);
    if (!isWalletAddress(normalizedAddress)) {
      throw new Error('Invalid contact address.');
    }
    if (!normalizedState) {
      throw new Error('Conversation state is empty.');
    }

    return runWalletTransactionFlow(async () => {
      const { signer, cacheKey } = await getMemoSigner();
      const selector = await resolveSubmitSelector();
      const requiredFee = await resolveRequiredFeeForSend();
      const normalizedVisibleNotice = visibleNotice.replace(/\r?\n/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH);
      const submittedTx = await submitHiddenConversationStateMemo({
        signer,
        contactAddress: normalizedAddress,
        state: normalizedState,
        visibleNotice: normalizedVisibleNotice,
        selector,
        requiredFee,
        encodeMemo: encodeMemoForActiveSigner
      });

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      await submittedTx.wait();

      return submittedTx.txHash;
    });
  };

  const syncConversationStateFromInput = async (
    contactAddress: string,
    state: ConversationPreferenceState,
    visibleNotice = ''
  ): Promise<boolean> => {
    if (browserWalletLiteMode) {
      setError('Use the ChainWhisper account to sync muted or hidden conversations.');
      return false;
    }

    const normalizedAddress = contactAddress.trim();
    const normalizedState = normalizeConversationPreferenceState(state);
    if (!isWalletAddress(normalizedAddress) || !normalizedState) {
      return false;
    }

    if (!walletAddress || !hasAesReady || chainId !== COTI_NETWORK.chainIdDecimal) {
      return false;
    }

    if (normalizedAddress.toLowerCase() === walletAddress.toLowerCase()) {
      return false;
    }

    try {
      const normalizedVisibleNotice = visibleNotice.replace(/\r?\n/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH);
      await sendHiddenConversationStateToContact(normalizedAddress, normalizedState, normalizedVisibleNotice);
      syncConversationHistory({ updateHead: true, skipContactStateUpdate: true }).catch(() => {});
      setTopUpMetricsNonce((previous) => previous + 1);
      return true;
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : 'Failed to sync conversation state.';
      setError(`Conversation state sync failed. No local change was applied: ${message}`);
      if (activeSignerSource === 'burner' && hasInsufficientFundsError(message)) {
        requestChainWhisperFundingAfterError(message);
      }
      return false;
    }
  };

  return {
    syncContactNameAliasFromInput,
    syncConversationStateFromInput
  };
}
