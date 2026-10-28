import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { JsonRpcSigner } from '@coti-io/coti-ethers';
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
  writeTradeAgentPaymentRetry,
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
  signer: JsonRpcSigner;
  cacheKey: string;
};

type RunPaidChatTradeAgentRequestInput = {
  action: TradeAgentActionType;
  context: unknown;
  origin: ChatTradeAgentOperationGuard;
  prompt: string;
  workingStatus: string;
};

export type ChatTradeAgentOperationOrigin = {
  conversationKey: string;
  generation: number;
  linkedTradeKey: string;
  operationId: number;
  sourceMessageId: string | null;
  walletKey: string;
  walletSessionEpoch: number;
};

type ChatTradeAgentOperationGuard = {
  assertCurrent: () => void;
  commit: (mutation: () => void) => void;
  finish: () => void;
  isCurrent: () => boolean;
  origin: ChatTradeAgentOperationOrigin;
};

type CompletedPaidChatTradeAgentRequest = {
  paidRequest: TradeAgentPaymentRetryRecord | null;
  response: TradeAgentResponse;
};

class ChatTradeAgentOriginChangedError extends Error {
  constructor() {
    super('The conversation changed while Trade Agent was working. Reopen the original message or linked order to recover the paid response.');
    this.name = 'ChatTradeAgentOriginChangedError';
  }
}

const isChatTradeAgentOriginChangedError = (
  error: unknown
): error is ChatTradeAgentOriginChangedError =>
  error instanceof ChatTradeAgentOriginChangedError;

export const commitChatTradeAgentOriginMutation = (
  origin: ChatTradeAgentOperationOrigin,
  current: ChatTradeAgentOperationOrigin,
  mutation: () => void
): boolean => {
  if (
    origin.conversationKey !== current.conversationKey ||
    origin.generation !== current.generation ||
    origin.linkedTradeKey !== current.linkedTradeKey ||
    origin.operationId !== current.operationId ||
    origin.sourceMessageId !== current.sourceMessageId ||
    origin.walletKey !== current.walletKey ||
    origin.walletSessionEpoch !== current.walletSessionEpoch
  ) {
    return false;
  }
  mutation();
  return true;
};

export const completeIrreversibleChatTradeAgentPayment = (
  paymentTxHash: string,
  isOriginCurrent: () => boolean
): { originChanged: boolean; paymentTxHash: string } => ({
  originChanged: !isOriginCurrent(),
  paymentTxHash
});

const normalizeOriginKey = (value?: string | null): string =>
  value?.trim().toLowerCase() ?? '';

const buildChatTradeAgentConversationKey = (
  activeContact: string | null,
  activeGroupId: number | null
): string =>
  activeGroupId !== null
    ? `group:${activeGroupId}`
    : activeContact
      ? `contact:${normalizeOriginKey(activeContact)}`
      : '';

const buildChatTradeAgentLinkedTradeKey = (
  context: LinkedTradeContext | null
): string =>
  context
    ? `${normalizeOriginKey(context.escrowContract) || 'default'}:${context.tradeId}`
    : '';

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
  activeContact: string | null;
  activeGroupId: number | null;
  activeLinkedTradeContext: LinkedTradeContext | null;
  currentWalletKeyRef: MutableRefObject<string>;
  draftingTradeMessageId: string;
  getMemoSigner: () => Promise<MemoSignerBundle>;
  handleMessageInputChange: (value: string) => void;
  negotiatingLinkedTradeKey: string;
  prepareCounterTrade: (
    offer: TradeOfferMessagePayload,
    sourceMessage: ChatMessage,
    isTargetCurrent?: () => boolean
  ) => Promise<void>;
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
  walletSessionEpochRef: MutableRefObject<number>;
};

export default function useChatTradeAgentActions({
  activeContact,
  activeGroupId,
  activeLinkedTradeContext,
  currentWalletKeyRef,
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
  walletAddress,
  walletSessionEpochRef
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
  const currentChatTradeAgentOriginRef = useRef({
    conversationKey: buildChatTradeAgentConversationKey(activeContact, activeGroupId),
    generation: 0,
    linkedTradeContext: activeLinkedTradeContext,
    linkedTradeKey: buildChatTradeAgentLinkedTradeKey(activeLinkedTradeContext),
    walletKey: normalizeOriginKey(currentWalletKeyRef.current || walletAddress),
    walletSessionEpoch: walletSessionEpochRef.current
  });
  const currentChatTradeAgentOperationRef = useRef<ChatTradeAgentOperationOrigin | null>(null);
  const chatTradeAgentOperationSequenceRef = useRef(0);

  useLayoutEffect(() => {
    const previous = currentChatTradeAgentOriginRef.current;
    const conversationKey = buildChatTradeAgentConversationKey(activeContact, activeGroupId);
    const linkedTradeKey = buildChatTradeAgentLinkedTradeKey(activeLinkedTradeContext);
    const walletKey = normalizeOriginKey(walletAddress);
    const changed =
      previous.conversationKey !== conversationKey ||
      previous.linkedTradeContext !== activeLinkedTradeContext ||
      previous.linkedTradeKey !== linkedTradeKey ||
      previous.walletKey !== walletKey ||
      previous.walletSessionEpoch !== walletSessionEpochRef.current;
    currentChatTradeAgentOriginRef.current = {
      conversationKey,
      generation: previous.generation + (changed ? 1 : 0),
      linkedTradeContext: activeLinkedTradeContext,
      linkedTradeKey,
      walletKey,
      walletSessionEpoch: walletSessionEpochRef.current
    };
  }, [
    activeContact,
    activeGroupId,
    activeLinkedTradeContext,
    walletAddress,
    walletSessionEpochRef
  ]);

  const beginChatTradeAgentOperation = useCallback(
    (sourceMessageId: string | null): ChatTradeAgentOperationGuard | null => {
      if (currentChatTradeAgentOperationRef.current) {
        return null;
      }
      const previous = currentChatTradeAgentOriginRef.current;
      const walletKey = normalizeOriginKey(currentWalletKeyRef.current);
      const walletSessionEpoch = walletSessionEpochRef.current;
      const current =
        previous.walletKey === walletKey && previous.walletSessionEpoch === walletSessionEpoch
        ? previous
        : {
            ...previous,
            generation: previous.generation + 1,
            walletKey,
            walletSessionEpoch
          };
      currentChatTradeAgentOriginRef.current = current;
      const origin: ChatTradeAgentOperationOrigin = {
        conversationKey: current.conversationKey,
        generation: current.generation,
        linkedTradeKey: current.linkedTradeKey,
        operationId: ++chatTradeAgentOperationSequenceRef.current,
        sourceMessageId,
        walletKey: current.walletKey,
        walletSessionEpoch: current.walletSessionEpoch
      };
      currentChatTradeAgentOperationRef.current = origin;

      const readCurrent = (): ChatTradeAgentOperationOrigin => {
        const latest = currentChatTradeAgentOriginRef.current;
        const operation = currentChatTradeAgentOperationRef.current;
        return {
          conversationKey: latest.conversationKey,
          generation: latest.generation,
          linkedTradeKey: latest.linkedTradeKey,
          operationId: operation?.operationId ?? -1,
          sourceMessageId: operation?.sourceMessageId ?? null,
          walletKey: normalizeOriginKey(currentWalletKeyRef.current),
          walletSessionEpoch: walletSessionEpochRef.current
        };
      };
      const isCurrent = () =>
        commitChatTradeAgentOriginMutation(origin, readCurrent(), () => undefined);
      const assertCurrent = () => {
        if (!isCurrent()) {
          throw new ChatTradeAgentOriginChangedError();
        }
      };

      return {
        assertCurrent,
        commit: (mutation) => {
          if (!commitChatTradeAgentOriginMutation(origin, readCurrent(), mutation)) {
            throw new ChatTradeAgentOriginChangedError();
          }
        },
        finish: () => {
          if (currentChatTradeAgentOperationRef.current?.operationId === origin.operationId) {
            currentChatTradeAgentOperationRef.current = null;
          }
        },
        isCurrent,
        origin
      };
    },
    [currentWalletKeyRef, walletSessionEpochRef]
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
  const retainChatTradeAgentPaidRequest = useCallback(
    (record: TradeAgentPaymentRetryRecord | null) => {
      if (!record) {
        return;
      }
      try {
        writeTradeAgentPaymentRetry(record);
      } catch {
        // Keep the paid request in memory when browser retry storage is unavailable.
      }
      rememberChatTradeAgentPaidRequest(record);
    },
    [rememberChatTradeAgentPaidRequest]
  );

  const runPaidChatTradeAgentRequest = useCallback(
    async ({ action, context, origin, prompt, workingStatus }: RunPaidChatTradeAgentRequestInput): Promise<CompletedPaidChatTradeAgentRequest> => {
      origin.assertCurrent();
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
        throw new Error('Connect MetaMask or CipherTrade before using Trade Agent.');
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
        origin.assertCurrent();
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
        let paymentSigner: JsonRpcSigner | null = null;
        const getPaymentSigner = async (): Promise<JsonRpcSigner> => {
          origin.assertCurrent();
          if (!paymentSigner) {
            const signerBundle = await getMemoSigner();
            origin.assertCurrent();
            paymentSigner = signerBundle.signer;
          }
          return paymentSigner;
        };
        let recoveryChecked = false;

        const result = await orchestrateTradeAgentPayment<TradeAgentResponse>({
          request: paymentRequest,
          rejectConflictingRetry: true,
          retryRecord: chatTradeAgentPaidRequestRef.current,
          onPaidRequest: (record) => {
            rememberChatTradeAgentPaidRequest(record);
          },
          callbacks: {
            createQuote: async (request) => {
              origin.commit(() => setStatus('Getting the final WISP quote...'));
              const quote = await createTradeAgentPaymentQuote(request);
              origin.assertCurrent();
              return quote;
            },
            signAuthorization: async ({ authorizationMessage }) => {
              origin.commit(() => setStatus('Authorizing this exact request...'));
              const signer = await getPaymentSigner();
              origin.assertCurrent();
              const signature = await signer.signMessage(authorizationMessage);
              origin.assertCurrent();
              return signature;
            },
            transferPayment: async ({ quote }) => {
              origin.commit(() =>
                setStatus(
                  `Paying ${formatTokenAmount(BigInt(quote.feeAmountWei), quote.feeTokenDecimals, 4)} WISP...`
                )
              );
              let paymentTxHash = '';
              await runWalletTransactionFlow(async () => {
                origin.assertCurrent();
                const signer = await getPaymentSigner();
                origin.assertCurrent();
                const submittedPaymentTxHash = await transferWalletFundAsset({
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
                paymentTxHash = completeIrreversibleChatTradeAgentPayment(
                  submittedPaymentTxHash,
                  origin.isCurrent
                ).paymentTxHash;
              });
              return completeIrreversibleChatTradeAgentPayment(
                paymentTxHash,
                origin.isCurrent
              ).paymentTxHash;
            },
            runRequest: async (record: TradeAgentPaymentRetryRecord) => {
              // Payment is already irreversible here; this guard runs only after
              // orchestrateTradeAgentPayment has persisted the exact paid record.
              origin.assertCurrent();
              if (retryingExactRequest && !recoveryChecked) {
                recoveryChecked = true;
                origin.commit(() => setStatus('Recovering the previous Agent response...'));
                const signedAt = new Date().toISOString();
                const signer = await getPaymentSigner();
                origin.assertCurrent();
                const signature = await signer.signMessage(
                  buildTradeAgentRecoveryMessage({
                    payerAddress: record.payerAddress,
                    requestId: record.requestId,
                    signedAt
                  })
                );
                origin.assertCurrent();
                try {
                  const recovered = await recoverTradeAgentRequest({
                    normalization,
                    payerAddress: record.payerAddress,
                    requestId: record.requestId,
                    signature,
                    signedAt
                  });
                  origin.assertCurrent();
                  if (recovered.status !== 'retryable') {
                    return recovered;
                  }
                } catch (error) {
                  if (isChatTradeAgentOriginChangedError(error)) {
                    throw error;
                  }
                  origin.commit(() =>
                    setStatus('Recovery was unavailable. Retrying the exact paid request...')
                  );
                }
              }
              origin.commit(() =>
                setStatus(retryingExactRequest ? 'Retrying the paid Agent request...' : workingStatus)
              );
              const response = await runTradeAgentRequest({
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
              origin.assertCurrent();
              return response;
            }
          }
        });
        origin.assertCurrent();

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
        origin.commit(() => setStatus(workingStatus));
        return {
          paidRequest: chatTradeAgentPaidRequestRef.current,
          response: result.response
        };
      } catch (error) {
        const paidRequest =
          chatTradeAgentPaidRequestRef.current ??
          selectChatTradeAgentRetry(readTradeAgentPaymentRetry());
        if (paidRequest && chatTradeAgentPaidRequestRef.current === null) {
          rememberChatTradeAgentPaidRequest(paidRequest);
        }
        if (!origin.isCurrent() || isChatTradeAgentOriginChangedError(error)) {
          retainChatTradeAgentPaidRequest(paidRequest);
          throw new ChatTradeAgentOriginChangedError();
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
      retainChatTradeAgentPaidRequest,
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
    async (
      action: TradeAgentResponseAction,
      sourceMessage: ChatMessage,
      linkedTradeContext: LinkedTradeContext | null,
      origin: ChatTradeAgentOperationGuard
    ) => {
      if (action.type === 'prefill_message' && action.message) {
        origin.commit(() => handleMessageInputChange(action.message));
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
        if (!linkedTradeContext?.previewOffer) {
          origin.commit(() => setError('Open or link an order before drafting a counter.'));
          return;
        }
        await prepareCounterTrade(
          linkedTradeContext.previewOffer,
          sourceMessage,
          origin.isCurrent
        );
        origin.assertCurrent();
        origin.commit(() => applyDraftFields(action));
        return;
      }

      if (action.type === 'prefill_limit') {
        origin.commit(() => {
          setTradeCounterParentId(null);
          setTradeCounterContext(null);
          setReplyingToMessage(sourceMessage);
          setTipComposerOpen(false);
          setTradeComposerOpen(true);
          applyDraftFields(action);
        });
        return;
      }

      if (action.type === 'prefill_message') {
        origin.commit(() => handleMessageInputChange(action.message));
      }
    },
    [
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
      const tradeKey = buildChatTradeAgentLinkedTradeKey(context);
      if (negotiatingLinkedTradeKey) {
        return;
      }
      const origin = beginChatTradeAgentOperation(null);
      if (!origin) {
        return;
      }
      if (!origin.origin.conversationKey || origin.origin.linkedTradeKey !== tradeKey) {
        origin.finish();
        return;
      }

      let completedPaidRequest: TradeAgentPaymentRetryRecord | null = null;
      origin.commit(() => setNegotiatingLinkedTradeKey(tradeKey));
      try {
        const completed = await runPaidChatTradeAgentRequest({
          action: 'draft_counter',
          context: buildTradeAgentChatContext({ linkedTrade: context }),
          origin,
          prompt: `Draft one concise negotiation message for linked order #${context.tradeId}. Return only a message I can edit and send.`,
          workingStatus: 'Drafting negotiation...'
        });
        origin.assertCurrent();
        completedPaidRequest = completed.paidRequest;
        const response = completed.response;
        const draftAction = response.actions.find(
          (
            action
          ): action is Extract<TradeAgentResponseAction, { type: 'prefill_message' | 'prefill_counter' }> =>
            (action.type === 'prefill_message' || action.type === 'prefill_counter') && Boolean(action.message)
        );
        const draft = draftAction?.message ?? response.answer;
        origin.commit(() => {
          handleMessageInputChange(draft);
          setStatus('Negotiation draft ready.');
          rememberChatTradeAgentPaidRequest(null);
        });
      } catch (error) {
        retainChatTradeAgentPaidRequest(completedPaidRequest);
        if (!isChatTradeAgentOriginChangedError(error) && origin.isCurrent()) {
          origin.commit(() =>
            setError(getProviderErrorMessage(error, 'Could not draft negotiation message.'))
          );
        }
      } finally {
        if (currentChatTradeAgentOperationRef.current?.operationId === origin.origin.operationId) {
          setNegotiatingLinkedTradeKey('');
        }
        origin.finish();
      }
    },
    [
      beginChatTradeAgentOperation,
      handleMessageInputChange,
      negotiatingLinkedTradeKey,
      rememberChatTradeAgentPaidRequest,
      retainChatTradeAgentPaidRequest,
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
      const origin = beginChatTradeAgentOperation(message.id);
      if (!origin) {
        return;
      }
      if (!origin.origin.conversationKey.startsWith('contact:')) {
        origin.finish();
        return;
      }
      const linkedTradeContext = activeLinkedTradeContext;

      let completedPaidRequest: TradeAgentPaymentRetryRecord | null = null;
      origin.commit(() => setDraftingTradeMessageId(message.id));
      try {
        const safeContext = buildTradeAgentChatContext({
          linkedTrade: linkedTradeContext,
          selectedMessage: {
            direction: message.direction,
            text: messageText
          }
        });
        const completed = await runPaidChatTradeAgentRequest({
          action: 'chat_to_trade',
          context: safeContext,
          origin,
          prompt:
            'Turn the explicitly selected chat message into a ChainWhisper trade draft. ' +
            'If it counters the linked order, return a counter draft. Otherwise return a limit-order draft. Do not execute anything.',
          workingStatus: 'Drafting trade...'
        });
        origin.assertCurrent();
        completedPaidRequest = completed.paidRequest;
        const response = completed.response;
        const action = response.actions.find((candidate) =>
          candidate.type === 'prefill_counter' ||
          candidate.type === 'prefill_limit' ||
          candidate.type === 'prefill_message'
        );
        if (action) {
          await applyChatTradeAgentAction(action, message, linkedTradeContext, origin);
          origin.assertCurrent();
        } else {
          origin.commit(() => handleMessageInputChange(response.answer));
        }
        origin.commit(() => {
          setStatus('Trade draft ready.');
          rememberChatTradeAgentPaidRequest(null);
        });
      } catch (error) {
        retainChatTradeAgentPaidRequest(completedPaidRequest);
        if (!isChatTradeAgentOriginChangedError(error) && origin.isCurrent()) {
          origin.commit(() =>
            setError(getProviderErrorMessage(error, 'Could not draft a trade from this message.'))
          );
        }
      } finally {
        if (currentChatTradeAgentOperationRef.current?.operationId === origin.origin.operationId) {
          setDraftingTradeMessageId('');
        }
        origin.finish();
      }
    },
    [
      activeLinkedTradeContext,
      applyChatTradeAgentAction,
      beginChatTradeAgentOperation,
      draftingTradeMessageId,
      handleMessageInputChange,
      rememberChatTradeAgentPaidRequest,
      retainChatTradeAgentPaidRequest,
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
