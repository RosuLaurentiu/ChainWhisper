import { useCallback } from 'react';
import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import { formatTradeAgentFeeLabel } from '../../../app/appHelpers';
import {
  fetchTradeAgentFeeQuote,
  runTradeAgentRequest,
  type TradeAgentActionType,
  type TradeAgentResponseAction
} from '../../../lib/tradeAgent';
import {
  getMessageDisplayText,
  getProviderErrorMessage,
  sanitizeTokenAmountInput,
  type ChatMessage,
  type TradeOfferMessagePayload
} from '../../../lib/appShared';
import type { PendingTradeCounterContext, TradeTokenPresetKey } from '../../../lib/appHelpers';
import type { LinkedTradeContext } from '../../../lib/linkedTradeContext';
import type { TradeComposerModel } from '../../../lib/tradeComposer';
import { transferWalletFundAsset } from '../../../lib/walletFunds';
import type { StateUpdate } from '../../../shared/state/storeUtils';

type MemoSignerBundle = {
  signer: Wallet | JsonRpcSigner;
  cacheKey: string;
};

type RunPaidChatTradeAgentRequestInput = {
  action: TradeAgentActionType;
  context: unknown;
  prompt: string;
  workingStatus: string;
};

type UseChatTradeAgentActionsArgs = {
  activeLinkedTradeContext: LinkedTradeContext | null;
  draftingTradeMessageId: string;
  getMemoSigner: () => Promise<MemoSignerBundle>;
  handleMessageInputChange: (value: string) => void;
  negotiatingLinkedTradeKey: string;
  prepareCounterTrade: (offer: TradeOfferMessagePayload, sourceMessage: ChatMessage) => Promise<void>;
  runWalletTransactionFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  setDraftingTradeMessageId: (next: string) => void;
  setError: (next: string) => void;
  setNegotiatingLinkedTradeKey: (next: string) => void;
  setReplyingToMessage: (next: ChatMessage | null) => void;
  setStatus: (next: string) => void;
  setTipComposerOpen: (next: StateUpdate<boolean>) => void;
  setTradeComposerOpen: (next: StateUpdate<boolean>) => void;
  setTradeCounterContext: (next: StateUpdate<PendingTradeCounterContext | null>) => void;
  setTradeCounterParentId: (next: StateUpdate<number | null>) => void;
  setTradeOfferAmountInput: (next: StateUpdate<string>) => void;
  setTradeOfferTokenSelection: (next: StateUpdate<TradeTokenPresetKey>) => void;
  setTradeRequestAmountInput: (next: StateUpdate<string>) => void;
  setTradeRequestTokenSelection: (next: StateUpdate<TradeTokenPresetKey>) => void;
  tradeTokenOptions: TradeComposerModel['tradeTokenOptions'];
  walletAddress: string;
};

export default function useChatTradeAgentActions({
  activeLinkedTradeContext,
  draftingTradeMessageId,
  getMemoSigner,
  handleMessageInputChange,
  negotiatingLinkedTradeKey,
  prepareCounterTrade,
  runWalletTransactionFlow,
  setDraftingTradeMessageId,
  setError,
  setNegotiatingLinkedTradeKey,
  setReplyingToMessage,
  setStatus,
  setTipComposerOpen,
  setTradeComposerOpen,
  setTradeCounterContext,
  setTradeCounterParentId,
  setTradeOfferAmountInput,
  setTradeOfferTokenSelection,
  setTradeRequestAmountInput,
  setTradeRequestTokenSelection,
  tradeTokenOptions,
  walletAddress
}: UseChatTradeAgentActionsArgs) {
  const runPaidChatTradeAgentRequest = useCallback(
    async ({ action, context, prompt, workingStatus }: RunPaidChatTradeAgentRequestInput) => {
      if (!walletAddress) {
        throw new Error('Connect your ChainWhisper account before using Trade Agent.');
      }
      setStatus('Getting WISP fee quote...');
      const quote = await fetchTradeAgentFeeQuote(action);
      const { signer } = await getMemoSigner();
      let paymentTxHash = '';
      setStatus(`Paying ${formatTradeAgentFeeLabel(quote)}...`);
      await runWalletTransactionFlow(async () => {
        paymentTxHash = await transferWalletFundAsset({
          amountWei: BigInt(quote.feeAmountWei),
          asset: {
            kind: 'erc20',
            tokenAddress: quote.feeTokenAddress,
            symbol: 'WISP',
            decimals: quote.feeTokenDecimals
          },
          signer,
          toAddress: quote.feeRecipient
        });
      });
      setStatus(workingStatus);
      return runTradeAgentRequest({
        action,
        context,
        payerAddress: walletAddress,
        paymentTxHash,
        prompt
      });
    },
    [getMemoSigner, runWalletTransactionFlow, setStatus, walletAddress]
  );

  const resolveChatTradeAgentTokenSelection = useCallback(
    (token?: string): TradeTokenPresetKey | null => {
      const raw = token?.trim().toLowerCase() ?? '';
      if (!raw) {
        return null;
      }
      const normalizeLabel = (value: string) =>
        value
          .replace(/^âœ“\s*/, '')
          .replace(/\s+\([^)]*\)$/, '')
          .trim()
          .toLowerCase();
      const match = tradeTokenOptions.find((option) => {
        const values = [option.value, option.symbol, normalizeLabel(option.label)]
          .filter((value): value is string => Boolean(value))
          .map((value) => value.toLowerCase());
        return values.includes(raw);
      });
      return match ? (match.value as TradeTokenPresetKey) : null;
    },
    [tradeTokenOptions]
  );

  const applyChatTradeAgentAction = useCallback(
    async (action: TradeAgentResponseAction, sourceMessage: ChatMessage) => {
      if (action.type === 'prefill_message' && action.message) {
        handleMessageInputChange(action.message);
        return;
      }

      const applyDraftFields = () => {
        const sellSelection = resolveChatTradeAgentTokenSelection(action.sellToken);
        const buySelection = resolveChatTradeAgentTokenSelection(action.buyToken);
        if (sellSelection) {
          setTradeOfferTokenSelection(sellSelection);
        }
        if (buySelection && buySelection !== sellSelection) {
          setTradeRequestTokenSelection(buySelection);
        }
        setTradeOfferAmountInput(sanitizeTokenAmountInput(action.sellAmount ?? ''));
        setTradeRequestAmountInput(sanitizeTokenAmountInput(action.buyAmount ?? ''));
      };

      if (action.type === 'prefill_counter') {
        if (!activeLinkedTradeContext?.previewOffer) {
          setError('Open or link an order before drafting a counter.');
          return;
        }
        await prepareCounterTrade(activeLinkedTradeContext.previewOffer, sourceMessage);
        applyDraftFields();
        return;
      }

      if (action.type === 'prefill_limit') {
        setTradeCounterParentId(null);
        setTradeCounterContext(null);
        setReplyingToMessage(sourceMessage);
        setTipComposerOpen(false);
        setTradeComposerOpen(true);
        applyDraftFields();
        return;
      }

      if (action.message) {
        handleMessageInputChange(action.message);
      }
    },
    [
      activeLinkedTradeContext,
      handleMessageInputChange,
      prepareCounterTrade,
      resolveChatTradeAgentTokenSelection,
      setError,
      setReplyingToMessage,
      setTipComposerOpen,
      setTradeComposerOpen,
      setTradeCounterContext,
      setTradeCounterParentId,
      setTradeOfferAmountInput,
      setTradeOfferTokenSelection,
      setTradeRequestAmountInput,
      setTradeRequestTokenSelection
    ]
  );

  const negotiateLinkedTrade = useCallback(
    async (context: LinkedTradeContext) => {
      const tradeKey = `${context.escrowContract ?? 'default'}:${context.tradeId}`;
      if (negotiatingLinkedTradeKey) {
        return;
      }

      setNegotiatingLinkedTradeKey(tradeKey);
      try {
        const response = await runPaidChatTradeAgentRequest({
          action: 'draft_counter',
          context: {
            linkedTrade: {
              counterpartyAddress: context.counterpartyAddress,
              escrowContract: context.escrowContract,
              previewOffer: context.previewOffer,
              terminalPath: context.terminalPath,
              tradeId: context.tradeId
            }
          },
          prompt: `Draft one concise negotiation message for linked order #${context.tradeId}. Return only a message I can edit and send.`,
          workingStatus: 'Drafting negotiation...'
        });
        const draft =
          response.actions.find(
            (action) => (action.type === 'prefill_message' || action.type === 'prefill_counter') && action.message
          )?.message ?? response.answer;
        handleMessageInputChange(draft);
        setStatus('Negotiation draft ready.');
      } catch (error) {
        setError(getProviderErrorMessage(error, 'Could not draft negotiation message.'));
      } finally {
        setNegotiatingLinkedTradeKey('');
      }
    },
    [
      handleMessageInputChange,
      negotiatingLinkedTradeKey,
      runPaidChatTradeAgentRequest,
      setError,
      setNegotiatingLinkedTradeKey,
      setStatus
    ]
  );

  const draftTradeFromChatMessage = useCallback(
    async (message: ChatMessage) => {
      const messageText = getMessageDisplayText(message.text, message.direction).trim();
      if (!messageText || draftingTradeMessageId) {
        return;
      }

      setDraftingTradeMessageId(message.id);
      try {
        const response = await runPaidChatTradeAgentRequest({
          action: 'chat_to_trade',
          context: {
            linkedTrade: activeLinkedTradeContext
              ? {
                  counterpartyAddress: activeLinkedTradeContext.counterpartyAddress,
                  escrowContract: activeLinkedTradeContext.escrowContract,
                  previewOffer: activeLinkedTradeContext.previewOffer,
                  terminalPath: activeLinkedTradeContext.terminalPath,
                  tradeId: activeLinkedTradeContext.tradeId
                }
              : null,
            selectedMessage: {
              direction: message.direction,
              text: messageText,
              timestamp: message.timestamp
            }
          },
          prompt:
            `Turn this selected chat message into a ChainWhisper trade draft: "${messageText}". ` +
            'If it counters the linked order, return a counter draft. Otherwise return a limit-order draft. Do not execute anything.',
          workingStatus: 'Drafting trade...'
        });
        const action = response.actions.find((candidate) =>
          candidate.type === 'prefill_counter' ||
          candidate.type === 'prefill_limit' ||
          candidate.type === 'prefill_message'
        );
        if (action) {
          await applyChatTradeAgentAction(action, message);
        } else {
          handleMessageInputChange(response.answer);
        }
        setStatus('Trade draft ready.');
      } catch (error) {
        setError(getProviderErrorMessage(error, 'Could not draft a trade from this message.'));
      } finally {
        setDraftingTradeMessageId('');
      }
    },
    [
      activeLinkedTradeContext,
      applyChatTradeAgentAction,
      draftingTradeMessageId,
      handleMessageInputChange,
      runPaidChatTradeAgentRequest,
      setDraftingTradeMessageId,
      setError,
      setStatus
    ]
  );

  return {
    draftTradeFromChatMessage,
    negotiateLinkedTrade
  };
}
