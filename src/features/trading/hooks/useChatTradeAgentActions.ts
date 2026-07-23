import { useCallback, useMemo, useRef, useState } from 'react';
import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import {
  buildTradeAgentChatContext,
  createTradeAgentPaymentQuote,
  getTradeAgentPreflightError,
  isTradeAgentTerminalPaymentError,
  recoverTradeAgentRequest,
  runTradeAgentRequest,
  type TradeAgentActionType,
  type TradeAgentKnownToken,
  type TradeAgentResponse,
  type TradeAgentResponseAction
} from '../../../lib/tradeAgent';
import {
  buildTradeAgentRecoveryMessage,
  doesTradeAgentPaymentRetryMatch,
  hashTradeAgentPaymentRequest,
  orchestrateTradeAgentPayment,
  readTradeAgentPaymentRetry,
  type TradeAgentPaymentRequest,
  type TradeAgentPaymentRetryRecord,
  type TradeAgentSafeContext
} from '../../../lib/tradeAgentPayment';
import {
  formatTokenAmount,
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

export const selectChatTradeAgentRetry = (
  record: TradeAgentPaymentRetryRecord | null
): TradeAgentPaymentRetryRecord | null =>
  record?.context.clientSurface === 'chat' ? record : null;

export const isChatTradeAgentRetryAvailable = (
  record: TradeAgentPaymentRetryRecord | null,
  payerAddress: string
): boolean =>
  Boolean(
    record &&
    payerAddress &&
    record.payerAddress.toLowerCase() === payerAddress.toLowerCase()
  );

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
  const tradeAgentKnownTokens = useMemo<TradeAgentKnownToken[]>(
    () =>
      tradeTokenOptions
        .filter((option) => !option.value.startsWith('custom'))
        .map((option) => ({
          reference: option.symbol ?? option.value,
          aliases: [option.value, option.label]
        })),
    [tradeTokenOptions]
  );
  const chatTradeAgentRequestInFlightRef = useRef(false);
  const [pendingChatTradeAgentRetry, setPendingChatTradeAgentRetry] = useState(
    () => selectChatTradeAgentRetry(readTradeAgentPaymentRetry())
  );
  const chatTradeAgentPaidRequestRef = useRef<TradeAgentPaymentRetryRecord | null>(
    pendingChatTradeAgentRetry
  );
  const rememberChatTradeAgentPaidRequest = useCallback(
    (record: TradeAgentPaymentRetryRecord | null) => {
      chatTradeAgentPaidRequestRef.current = record;
      setPendingChatTradeAgentRetry(record);
    },
    []
  );

  const runPaidChatTradeAgentRequest = useCallback(
    async ({ action, context, prompt, workingStatus }: RunPaidChatTradeAgentRequestInput) => {
      const preflightError = getTradeAgentPreflightError({
        action,
        context,
        knownTokens: tradeAgentKnownTokens,
        prompt
      });
      if (preflightError) {
        throw new Error(preflightError);
      }
      if (!walletAddress) {
        throw new Error('Connect your ChainWhisper account before using Trade Agent.');
      }
      if (chatTradeAgentRequestInFlightRef.current) {
        throw new Error('A Trade Agent request is already processing.');
      }

      chatTradeAgentRequestInFlightRef.current = true;
      let currentPaymentRequest: TradeAgentPaymentRequest | null = null;
      try {
        const paymentRequest: TradeAgentPaymentRequest = {
          action,
          context: context as TradeAgentSafeContext,
          payerAddress: walletAddress,
          prompt
        };
        currentPaymentRequest = paymentRequest;
        const storedRetry =
          chatTradeAgentPaidRequestRef.current ?? readTradeAgentPaymentRetry();
        if (
          storedRetry?.context.clientSurface === 'chat' &&
          chatTradeAgentPaidRequestRef.current === null
        ) {
          rememberChatTradeAgentPaidRequest(storedRetry);
        }
        const expectedRequestHash = await hashTradeAgentPaymentRequest(paymentRequest);
        const retryingExactRequest = Boolean(
          storedRetry &&
          storedRetry.context.clientSurface === 'chat' &&
          doesTradeAgentPaymentRetryMatch(storedRetry, paymentRequest) &&
          storedRetry.requestHash === expectedRequestHash
        );
        const linkedTrade =
          context && typeof context === 'object' &&
          (context as Record<string, unknown>).linkedTrade &&
          typeof (context as Record<string, unknown>).linkedTrade === 'object'
            ? (context as Record<string, unknown>).linkedTrade as Record<string, unknown>
            : null;
        const trustedOrders =
          linkedTrade &&
          typeof linkedTrade.tradeId === 'number' &&
          Number.isSafeInteger(linkedTrade.tradeId) &&
          typeof linkedTrade.escrowContract === 'string'
            ? [{
                tradeId: linkedTrade.tradeId,
                escrowContract: linkedTrade.escrowContract
              }]
            : [];
        const normalization = {
          knownTokens: tradeAgentKnownTokens,
          trustedOrders
        };
        let paymentSigner: Wallet | JsonRpcSigner | null = null;
        const getPaymentSigner = async (): Promise<Wallet | JsonRpcSigner> => {
          paymentSigner ??= (await getMemoSigner()).signer;
          return paymentSigner;
        };
        let recoveryChecked = false;

        const result = await orchestrateTradeAgentPayment<TradeAgentResponse>({
          request: paymentRequest,
          retryRecord: chatTradeAgentPaidRequestRef.current,
          onPaidRequest: (record) => {
            rememberChatTradeAgentPaidRequest(record);
          },
          callbacks: {
            createQuote: async (request) => {
              setStatus('Getting the final WISP quote...');
              return createTradeAgentPaymentQuote(request);
            },
            signAuthorization: async ({ authorizationMessage }) => {
              setStatus('Authorizing this exact request...');
              return (await getPaymentSigner()).signMessage(authorizationMessage);
            },
            transferPayment: async ({ quote }) => {
              setStatus(
                `Paying ${formatTokenAmount(BigInt(quote.feeAmountWei), quote.feeTokenDecimals, 4)} WISP...`
              );
              let paymentTxHash = '';
              await runWalletTransactionFlow(async () => {
                paymentTxHash = await transferWalletFundAsset({
                  amountWei: BigInt(quote.feeAmountWei),
                  asset: {
                    kind: 'erc20',
                    tokenAddress: quote.feeTokenAddress,
                    symbol: 'WISP',
                    decimals: quote.feeTokenDecimals
                  },
                  signer: await getPaymentSigner(),
                  toAddress: quote.feeRecipient
                });
              });
              return paymentTxHash;
            },
            runRequest: async (record: TradeAgentPaymentRetryRecord) => {
              if (retryingExactRequest && !recoveryChecked) {
                recoveryChecked = true;
                setStatus('Recovering the previous Agent response...');
                const signedAt = new Date().toISOString();
                const signature = await (await getPaymentSigner()).signMessage(
                  buildTradeAgentRecoveryMessage({
                    payerAddress: record.payerAddress,
                    requestId: record.requestId,
                    signedAt
                  })
                );
                try {
                  const recovered = await recoverTradeAgentRequest({
                    normalization,
                    payerAddress: record.payerAddress,
                    requestId: record.requestId,
                    signature,
                    signedAt
                  });
                  if (recovered.status !== 'retryable') {
                    return recovered;
                  }
                } catch {
                  setStatus('Recovery was unavailable. Retrying the exact paid request...');
                }
              }
              setStatus(retryingExactRequest ? 'Retrying the paid Agent request...' : workingStatus);
              return runTradeAgentRequest({
                action: record.action,
                context: record.context,
                normalization,
                payerAddress: record.payerAddress,
                payerSignature: record.payerSignature,
                paymentTxHash: record.paymentTxHash,
                prompt: record.prompt,
                quoteToken: record.quoteToken,
                requestHash: record.requestHash,
                requestId: record.requestId
              });
            }
          }
        });

        if (result.status === 'processing') {
          const retryInSeconds = Math.max(1, Math.ceil((result.retryAfterMs ?? 2_000) / 1_000));
          throw new Error(
            `Payment confirmed. This Agent request is still processing; retry in about ${retryInSeconds} seconds without paying again.`
          );
        }
        if (result.status === 'retryable') {
          throw new Error(
            result.error ||
            'The provider did not finish this exact request. Retry without paying again.'
          );
        }
        setStatus(workingStatus);
        rememberChatTradeAgentPaidRequest(null);
        return result.response;
      } catch (error) {
        const paidRequest =
          chatTradeAgentPaidRequestRef.current ??
          selectChatTradeAgentRetry(readTradeAgentPaymentRetry());
        if (paidRequest && chatTradeAgentPaidRequestRef.current === null) {
          rememberChatTradeAgentPaidRequest(paidRequest);
        }
        if (
          paidRequest &&
          currentPaymentRequest &&
          doesTradeAgentPaymentRetryMatch(paidRequest, currentPaymentRequest) &&
          isTradeAgentTerminalPaymentError(error)
        ) {
          const message = error instanceof Error ? error.message : 'The WISP payment could not be verified.';
          throw new Error(
            `${message} No additional payment will be requested; keep the payment transaction for manual WISP refund review.`
          );
        }
        throw error;
      } finally {
        chatTradeAgentRequestInFlightRef.current = false;
      }
    },
    [
      getMemoSigner,
      rememberChatTradeAgentPaidRequest,
      runWalletTransactionFlow,
      setStatus,
      tradeAgentKnownTokens,
      walletAddress
    ]
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

      const applyDraftFields = (
        draft: Extract<TradeAgentResponseAction, { type: 'prefill_counter' | 'prefill_limit' }>
      ) => {
        const sellSelection = resolveChatTradeAgentTokenSelection(draft.sellToken);
        const buySelection = resolveChatTradeAgentTokenSelection(draft.buyToken);
        if (sellSelection) {
          setTradeOfferTokenSelection(sellSelection);
        }
        if (buySelection && buySelection !== sellSelection) {
          setTradeRequestTokenSelection(buySelection);
        }
        setTradeOfferAmountInput(sanitizeTokenAmountInput(draft.sellAmount));
        setTradeRequestAmountInput(sanitizeTokenAmountInput(draft.buyAmount));
      };

      if (action.type === 'prefill_counter') {
        if (!activeLinkedTradeContext?.previewOffer) {
          setError('Open or link an order before drafting a counter.');
          return;
        }
        await prepareCounterTrade(activeLinkedTradeContext.previewOffer, sourceMessage);
        applyDraftFields(action);
        return;
      }

      if (action.type === 'prefill_limit') {
        setTradeCounterParentId(null);
        setTradeCounterContext(null);
        setReplyingToMessage(sourceMessage);
        setTipComposerOpen(false);
        setTradeComposerOpen(true);
        applyDraftFields(action);
        return;
      }

      if (action.type === 'prefill_message') {
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
          context: buildTradeAgentChatContext({ linkedTrade: context }),
          prompt: `Draft one concise negotiation message for linked order #${context.tradeId}. Return only a message I can edit and send.`,
          workingStatus: 'Drafting negotiation...'
        });
        const draftAction = response.actions.find(
          (
            action
          ): action is Extract<TradeAgentResponseAction, { type: 'prefill_message' | 'prefill_counter' }> =>
            (action.type === 'prefill_message' || action.type === 'prefill_counter') && Boolean(action.message)
        );
        const draft = draftAction?.message ?? response.answer;
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
        const safeContext = buildTradeAgentChatContext({
          linkedTrade: activeLinkedTradeContext,
          selectedMessage: {
            direction: message.direction,
            text: messageText
          }
        });
        const response = await runPaidChatTradeAgentRequest({
          action: 'chat_to_trade',
          context: safeContext,
          prompt:
            'Turn the explicitly selected chat message into a ChainWhisper trade draft. ' +
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
    hasPendingChatTradeAgentRetry: isChatTradeAgentRetryAvailable(
      pendingChatTradeAgentRetry,
      walletAddress
    ),
    draftTradeFromChatMessage,
    negotiateLinkedTrade
  };
}
