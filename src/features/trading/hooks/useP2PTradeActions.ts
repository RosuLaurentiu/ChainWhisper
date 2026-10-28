import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { JsonRpcSigner } from '@coti-io/coti-ethers';
import {
  buildTradeSnapshotKey,
  formatTokenAmount,
  parseTokenAmountInput,
  type TradeSnapshot
} from '../../../lib/appShared';
import { getOnChainFailureMessage } from '../../../lib/appHelpers';
import {
  getP2PActionFailureStatus,
  type P2PActionNoticeInput
} from '../../../lib/p2pActionNotice';
import {
  isTradeActionConfirmationCancelledError,
  type TradeFundingPreflightInput
} from '../../../lib/tradeActionConfirm';
import { formatWalletFundAmount } from '../../../lib/walletFunds';
import type { OtcV2ActionRuntime } from '../../../lib/otcV2ActionRuntime';
import { buildPrivateBookV2FillAction, getPrivateBookV2Projection } from '../../../lib/privateBookV2Consumer';
import { buildPrivateBookV2Review, executePrivateBookV2Review } from '../../../lib/privateBookV2Review';
import { isPrivateBookV2RuntimeHash, type PrivateBookV2Action } from '../../../lib/privateBookV2Actions';
import { isDirectTradeSnapshot } from '../../../lib/p2pTradeView';
import {
  buildOtcV2ConditionalApproval,
  buildOtcV2ConfirmationDetails
} from '../../../lib/otcV2Confirmation';

type TradeSigner = JsonRpcSigner;
export type CounterAcceptMode = 'close-related' | 'fill';

type UseP2PTradeActionsArgs = {
  ensureTradeFunding?: (input: TradeFundingPreflightInput) => Promise<void>;
  getTradeSigner: (requireAes: boolean) => Promise<TradeSigner>;
  getTradeSignerForWallet?: (walletAddress: string, requireAes: boolean) => Promise<TradeSigner>;
  mergeTradeSnapshot: (snapshot: TradeSnapshot) => void;
  openTrade: (tradeId: number, accessSecret?: string, escrowContract?: string) => void;
  rememberTradeTerminalReturn: (tradeId: number, accessSecret?: string, escrowContract?: string) => void;
  refreshTradeDataInBackground: (tradeId?: number, escrowContract?: string, signer?: TradeSigner) => void;
  readTradeDetail: (tradeId: number, escrowContract?: string) => Promise<TradeSnapshot | null>;
  resolveKnownTradeAccessSecret: (tradeId: number, escrowContract?: string) => string;
  rememberTradeAccessSecret?: (tradeId: number, accessSecret?: string, escrowContract?: string) => void;
  resolvedRouteAccessSecret: string;
  routeEscrowContract?: string;
  routeTradeId: number | null;
  runTradeWalletPromptFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  setTradeActionError: Dispatch<SetStateAction<string>>;
  walletAddress: string;
  resolveActionWalletAddress?: (
    snapshot: TradeSnapshot,
    action: 'accept' | 'cancel' | 'decline' | 'fill'
  ) => string;
  onActionNotice?: (notice: P2PActionNoticeInput) => void;
  otcV2ActionRuntime?: OtcV2ActionRuntime | null;
  refreshOneOffV2Trades?: () => void;
};

type UseP2PTradeActionsResult = {
  changePrivateBookBudgetVisibility: (snapshot: TradeSnapshot, visible: boolean) => Promise<void>;
  acceptTrade: (snapshot: TradeSnapshot, counterAcceptMode?: CounterAcceptMode) => Promise<void>;
  cancelTrade: (snapshot: TradeSnapshot) => Promise<void>;
  declineTrade: (snapshot: TradeSnapshot) => Promise<void>;
  partialFillTrade: (snapshot: TradeSnapshot, amountInput: string, options?: TradeFillActionOptions) => Promise<void>;
  processingTradeActionId: string;
};

export type TradeFillActionOptions = Partial<
  Pick<
    TradeFundingPreflightInput,
    | 'actionLabel'
    | 'confirmButtonLabel'
    | 'confirmMessage'
    | 'confirmationStats'
    | 'confirmTitle'
    | 'confirmationPolicy'
    | 'tradeSummary'
  >
> & {
  openAfterAction?: boolean;
  rememberTerminalReturn?: boolean;
};

const snapshotKey = (snapshot: Pick<TradeSnapshot, 'tradeId' | 'escrowContract'>): string =>
  buildTradeSnapshotKey(snapshot.tradeId, snapshot.escrowContract);

const remainingRequest = (snapshot: TradeSnapshot): bigint =>
  BigInt(snapshot.fillState?.remainingRequestAmount ?? snapshot.request.amount);

const remainingOffer = (snapshot: TradeSnapshot): bigint =>
  BigInt(snapshot.fillState?.remainingOfferAmount ?? snapshot.offer.amount);

const requirePositiveAmounts = (snapshot: TradeSnapshot): Readonly<{
  offer: bigint;
  request: bigint;
}> => {
  const offer = remainingOffer(snapshot);
  const request = remainingRequest(snapshot);
  if (offer <= 0n || request <= 0n) {
    throw new Error('This OTC V2 order has no remaining amount.');
  }
  return Object.freeze({ offer, request });
};

export default function useP2PTradeActions({
  ensureTradeFunding,
  mergeTradeSnapshot,
  openTrade,
  rememberTradeTerminalReturn,
  readTradeDetail,
  runTradeWalletPromptFlow,
  setTradeActionError,
  walletAddress,
  onActionNotice,
  otcV2ActionRuntime,
  refreshOneOffV2Trades
}: UseP2PTradeActionsArgs): UseP2PTradeActionsResult {
  const [processingTradeActionId, setProcessingTradeActionId] = useState('');

  const notify = useCallback((input: Omit<P2PActionNoticeInput, 'surface'>) => {
    onActionNotice?.({ ...input, surface: 'terminal' });
  }, [onActionNotice]);

  const requireV2 = useCallback(async (snapshot: TradeSnapshot) => {
    const identity = snapshot.v2;
    if (!identity) {
      throw new Error('Legacy OTC orders are read-only. Create or use an OTC V2 order.');
    }
    if (!otcV2ActionRuntime || !otcV2ActionRuntime.isCurrent()) {
      throw new Error('This OTC V2 order is unavailable in the current wallet session.');
    }
    const runtime = await otcV2ActionRuntime.forReference?.({ chainId: identity.chainId, contractAddress: identity.contractAddress, orderId: String(snapshot.tradeId) }) ?? otcV2ActionRuntime;
    if (!runtime.isCurrent()) throw new Error('The referenced OTC runtime is closed.');
    const deployment = runtime.deployments[identity.protocol];
    if (
      identity.chainId !== deployment.chainId ||
      identity.contractAddress.toLowerCase() !== deployment.contractAddress.toLowerCase() ||
      snapshot.escrowContract?.toLowerCase() !== deployment.contractAddress.toLowerCase()
    ) {
      throw new Error('This order does not match the verified OTC V2 deployment.');
    }
    const privateBook = getPrivateBookV2Projection(snapshot);
    if (identity.protocol === 'private-v2' &&
        (Boolean(privateBook) !== (isPrivateBookV2RuntimeHash(deployment.runtimeBytecodeHash)))) {
      throw new Error('Private book terms do not match the verified runtime. Refresh the order.');
    }
    return Object.freeze({ identity, runtime });
  }, [otcV2ActionRuntime]);

  const runAction = useCallback(async ({
    action,
    snapshot,
    operation
  }: {
    action: P2PActionNoticeInput['action'];
    snapshot: TradeSnapshot;
    operation: (markPending: () => void) => Promise<{
      txHash: string;
      refreshDisplay: ReadonlyArray<() => void>;
    } | undefined>;
  }) => {
    const tradeKey = snapshotKey(snapshot);
    setTradeActionError('');
    setProcessingTradeActionId(tradeKey);
    notify({ action, status: 'wallet', tradeKey });
    try {
      let pendingMarked = false;
      const markPending = () => {
        if (pendingMarked) return;
        pendingMarked = true;
        notify({ action, status: 'pending', tradeKey });
      };
      const result = await runTradeWalletPromptFlow(() => operation(markPending));
      if (!result) return undefined;
      // Execution has returned its confirmed receipt. Display failures cannot undo it.
      let message: string | undefined;
      for (const refresh of result.refreshDisplay) {
        try {
          await refresh();
        } catch {
          message = 'Transaction confirmed. The trade display needs a refresh. Do not submit this action again.';
        }
      }
      if (message) setTradeActionError(message);
      notify({ action, status: 'success', tradeKey, txHash: result.txHash, message });
      return result;
    } catch (error) {
      if (isTradeActionConfirmationCancelledError(error)) {
        notify({ action, message: 'Action cancelled', status: 'info', tradeKey });
        return undefined;
      }
      const fallback = action === 'budget-visibility' ? 'Failed to change budget visibility.'
        : action === 'decline' ? 'Failed to refuse trade.' : `Failed to ${action} trade.`;
      const message = getOnChainFailureMessage(error, fallback);
      setTradeActionError(message);
      notify({ action, message, status: getP2PActionFailureStatus(message), tradeKey });
      return undefined;
    } finally {
      setProcessingTradeActionId('');
    }
  }, [notify, runTradeWalletPromptFlow, setTradeActionError]);

  const runPrivateBookReview = useCallback(async (
    runtime: OtcV2ActionRuntime, snapshot: TradeSnapshot, action: PrivateBookV2Action, markPending: () => void
  ) => {
    if (action.kind === 'budget-visibility' && runtime.privateBook?.budgetVisibilityAvailable !== true) throw new Error('Budget visibility is unavailable.');
    if (!ensureTradeFunding) throw new Error('Private book actions require transaction review.');
    if (!getPrivateBookV2Projection(snapshot)) throw new Error('Refresh the current private book order before acting.');
    const review = await buildPrivateBookV2Review({ runtime, action, resolveTokenMetadata: (kind, address) => {
      const asset = [snapshot.offer, snapshot.request].find(item => item.kind === kind && item.tokenAddress?.toLowerCase() === address.toLowerCase());
      if (!asset) throw new Error('Private book token differs from the reviewed order.');
      return { symbol: asset.symbol, decimals: asset.decimals };
    } });
    const payment = action.kind === 'fill'
      ? action.terms.mode === 'private-pair' ? BigInt(action.terms.maxRequestAmount)
        : action.terms.mode === 'private-offer-public-request' ? BigInt(action.terms.publicRequestAmount)
          : BigInt(action.terms.maxPrivateRequestAmount)
      : 0n;
    const confirmed = await executePrivateBookV2Review({ runtime, review, confirm: async details => {
      const visibilityLabel = action.kind === 'budget-visibility' ? action.visible ? 'Publish original budget' : 'Hide budget' : undefined;
      await ensureTradeFunding({
        actionLabel: visibilityLabel ?? (action.kind === 'fill' ? 'fill trade' : 'cancel order'),
        confirmButtonLabel: visibilityLabel ?? (action.kind === 'fill' ? 'Confirm maximum payment' : 'Cancel order'),
        confirmTitle: visibilityLabel ?? (action.kind === 'fill' ? 'Review maximum payment' : 'Confirm cancellation'),
        confirmationPolicy: 'always', confirmMessage: details.confirmMessage,
        confirmationStats: details.confirmationStats, tradeSummary: details.tradeSummary,
        requirements: payment > 0n ? [{ asset: snapshot.request, amountWei: payment, reason: 'maximum trade payment' }] : []
      });
      markPending();
      return true;
    } });
    if (!confirmed) throw new Error('Private book action was not confirmed.');
    return confirmed;
  }, [ensureTradeFunding]);

  const acceptTrade = useCallback(async (snapshot: TradeSnapshot) => {
    if (!walletAddress) {
      const tradeKey = snapshotKey(snapshot);
      const message = 'Connect a wallet first.';
      setTradeActionError(message);
      notify({ action: 'accept', message, status: 'error', tradeKey });
      return;
    }
    await runAction({
      action: 'accept',
      snapshot,
      operation: async (markPending) => {
        rememberTradeTerminalReturn(snapshot.tradeId, undefined, snapshot.escrowContract);
        const latest = (await readTradeDetail(snapshot.tradeId, snapshot.escrowContract)) ?? snapshot;
        const v2 = await requireV2(latest);
        if (v2.identity.protocol === 'private-v2' && isPrivateBookV2RuntimeHash(v2.runtime.deployments['private-v2'].runtimeBytecodeHash)) {
          throw new Error('Enter a maximum payment. Private book inventory cannot be accepted as a fixed full amount.');
        }
        const amounts = requirePositiveAmounts(latest);
        const tradeSummary = [
          { label: 'Trade', value: `#${latest.tradeId}` },
          { label: 'You pay', value: formatWalletFundAmount(amounts.request, latest.request) },
          { label: 'You buy', value: formatWalletFundAmount(amounts.offer, latest.offer) }
        ];
        const approval = buildOtcV2ConditionalApproval({
          amountWei: amounts.request,
          kind: latest.request.kind === 'native' ? 'none' : latest.request.kind,
          symbol: latest.request.symbol
        });
        const confirmation = buildOtcV2ConfirmationDetails({
          approvals: approval ? [approval] : [],
          cotiPrivateInputCount:
            v2.identity.protocol === 'private-v2' ||
            (v2.identity.protocol === 'direct-v2' && latest.request.kind === 'private-erc20')
              ? 1
              : 0,
          summaryRows: tradeSummary
        });
        await ensureTradeFunding?.({
          actionLabel: 'accept trade',
          confirmButtonLabel: 'Buy',
          confirmMessage: confirmation.confirmMessage,
          confirmationPolicy: 'always',
          confirmationStats: confirmation.confirmationStats,
          confirmTitle: 'Review purchase',
          tradeSummary: confirmation.tradeSummary,
          requirements: [{ asset: latest.request, amountWei: amounts.request, reason: 'trade payment' }]
        });
        markPending();

        let transactionHash: string;
        if (v2.identity.protocol === 'standard-v2') {
          const quote = await v2.runtime.quoteStandard(latest.tradeId, amounts.request);
          if (quote.revision !== v2.identity.revision) {
            throw new Error('This Standard OTC V2 quote is stale. Refresh and review it again.');
          }
          transactionHash = (await v2.runtime.standard({
            kind: 'fill',
            tradeId: latest.tradeId,
            expectedRevision: quote.revision,
            requestAmountIn: quote.requestAmountIn,
            minOfferAmountOut: quote.offerAmountOut,
            requestAsset: latest.request.kind === 'native'
              ? { assetType: 'native' }
              : { assetType: 'erc20', token: latest.request.tokenAddress }
          })).transactionHash;
        } else if (v2.identity.protocol === 'private-v2') {
          if (!v2.identity.revision || !v2.identity.privateMode) {
            throw new Error('Private OTC V2 revision or mode is unavailable.');
          }
          const terms = v2.identity.privateMode === 'fully-private'
            ? { mode: 'fully-private' as const, maxRequestAmount: amounts.request, minOfferAmount: amounts.offer }
            : v2.identity.privateMode === 'private-offer-public-request'
              ? { mode: 'private-offer-public-request' as const, publicRequestAmount: amounts.request, minPrivateOfferAmount: amounts.offer }
              : { mode: 'public-offer-private-request' as const, publicOfferAmount: amounts.offer, maxPrivateRequestAmount: amounts.request };
          transactionHash = (await v2.runtime.privateTrade({
            kind: 'fill', orderId: latest.tradeId, expectedRevision: v2.identity.revision, terms
          })).transactionHash;
        } else if (latest.request.kind === 'private-erc20') {
          if (!latest.request.tokenAddress) throw new Error('Direct private request token is unavailable.');
          transactionHash = (await v2.runtime.direct({
            kind: 'accept-private',
            tradeId: latest.tradeId,
            expectedRequestAmount: amounts.request,
            requestToken: latest.request.tokenAddress
          })).transactionHash;
        } else {
          transactionHash = (await v2.runtime.direct({
            kind: 'accept-public',
            tradeId: latest.tradeId,
            expectedOfferAmount: amounts.offer,
            expectedRequestAmount: amounts.request,
            requestAsset: latest.request.kind === 'native'
              ? { assetType: 'native' }
              : { assetType: 'erc20', token: latest.request.tokenAddress }
          })).transactionHash;
        }
        return { txHash: transactionHash, refreshDisplay: [
          () => refreshOneOffV2Trades?.(),
          () => openTrade(latest.tradeId, undefined, latest.escrowContract)
        ] };
      }
    });
  }, [
    ensureTradeFunding,
    notify,
    openTrade,
    readTradeDetail,
    refreshOneOffV2Trades,
    rememberTradeTerminalReturn,
    requireV2,
    runPrivateBookReview,
    runAction,
    setTradeActionError,
    walletAddress
  ]);

  const partialFillTrade = useCallback(async (
    snapshot: TradeSnapshot,
    amountInput: string,
    options?: TradeFillActionOptions
  ) => {
    if (!walletAddress) {
      const tradeKey = snapshotKey(snapshot);
      const message = 'Connect a wallet first.';
      setTradeActionError(message);
      notify({ action: 'fill', message, status: 'error', tradeKey });
      return;
    }
    if (snapshot.counterParentTradeId) {
      const tradeKey = snapshotKey(snapshot);
      const message = 'Counter offers are accepted in full.';
      setTradeActionError(message);
      notify({ action: 'fill', message, status: 'error', tradeKey });
      return;
    }
    await runAction({
      action: 'fill',
      snapshot,
      operation: async (markPending) => {
        if (options?.rememberTerminalReturn !== false) {
          rememberTradeTerminalReturn(snapshot.tradeId, undefined, snapshot.escrowContract);
        }
        const latest = (await readTradeDetail(snapshot.tradeId, snapshot.escrowContract)) ?? snapshot;
        if (isDirectTradeSnapshot(latest)) {
          throw new Error('Direct OTC offers are accepted in full and do not support partial fills.');
        }
        const v2 = await requireV2(latest);
        const requestedAmount = parseTokenAmountInput(amountInput, latest.request.decimals);
        if (requestedAmount === null || requestedAmount <= 0n) {
          throw new Error(`Enter a valid ${latest.request.symbol} amount to fill.`);
        }
        if (v2.identity.protocol === 'private-v2' && isPrivateBookV2RuntimeHash(v2.runtime.deployments['private-v2'].runtimeBytecodeHash)) {
          const action = buildPrivateBookV2FillAction(latest, requestedAmount);
          const confirmed = await runPrivateBookReview(v2.runtime, latest, action, markPending);
          return { txHash: confirmed.transactionHash, refreshDisplay: [
            () => { if (options?.openAfterAction !== false) openTrade(latest.tradeId, undefined, latest.escrowContract); },
            () => refreshOneOffV2Trades?.()
          ] };
        }
        const amounts = requirePositiveAmounts(latest);
        if (requestedAmount > amounts.request) {
          throw new Error(
            `Only ${formatTokenAmount(amounts.request, latest.request.decimals, 6)} ${latest.request.symbol} remains.`
          );
        }
        const offerEstimate = (requestedAmount * amounts.offer) / amounts.request;
        const tradeSummary = options?.tradeSummary ?? [
          { label: 'Trade', value: `#${latest.tradeId}` },
          { label: 'You pay', value: formatWalletFundAmount(requestedAmount, latest.request) },
          { label: 'Receive', value: formatWalletFundAmount(offerEstimate, latest.offer) }
        ];
        const approval = buildOtcV2ConditionalApproval({
          amountWei: requestedAmount,
          kind: latest.request.kind === 'native' ? 'none' : latest.request.kind,
          symbol: latest.request.symbol
        });
        const confirmation = buildOtcV2ConfirmationDetails({
          approvals: approval ? [approval] : [],
          cotiPrivateInputCount: v2.identity.protocol === 'private-v2' ? 1 : 0,
          summaryRows: tradeSummary
        });
        await ensureTradeFunding?.({
          actionLabel: options?.actionLabel ?? 'fill trade',
          confirmButtonLabel: options?.confirmButtonLabel,
          confirmMessage: options?.confirmMessage ?? confirmation.confirmMessage,
          confirmationStats: confirmation.confirmationStats,
          confirmTitle: options?.confirmTitle,
          confirmationPolicy: 'always',
          tradeSummary: confirmation.tradeSummary,
          requirements: [{ asset: latest.request, amountWei: requestedAmount, reason: 'trade payment' }]
        });
        markPending();

        let transactionHash: string;
        if (v2.identity.protocol === 'standard-v2') {
          const quote = await v2.runtime.quoteStandard(latest.tradeId, requestedAmount);
          if (quote.revision !== v2.identity.revision) {
            throw new Error('This Standard OTC V2 quote is stale. Refresh and review it again.');
          }
          transactionHash = (await v2.runtime.standard({
            kind: 'fill',
            tradeId: latest.tradeId,
            expectedRevision: quote.revision,
            requestAmountIn: quote.requestAmountIn,
            minOfferAmountOut: quote.offerAmountOut,
            requestAsset: latest.request.kind === 'native'
              ? { assetType: 'native' }
              : { assetType: 'erc20', token: latest.request.tokenAddress }
          })).transactionHash;
        } else {
          if (!v2.identity.revision || !v2.identity.privateMode) {
            throw new Error('Private OTC V2 revision or mode is unavailable.');
          }
          const minimumOffer = (requestedAmount * amounts.offer) / amounts.request;
          if (minimumOffer <= 0n) throw new Error('This private fill is too small at the current order price.');
          const terms = v2.identity.privateMode === 'fully-private'
            ? { mode: 'fully-private' as const, maxRequestAmount: requestedAmount, minOfferAmount: minimumOffer }
            : v2.identity.privateMode === 'private-offer-public-request'
              ? { mode: 'private-offer-public-request' as const, publicRequestAmount: requestedAmount, minPrivateOfferAmount: minimumOffer }
              : { mode: 'public-offer-private-request' as const, publicOfferAmount: minimumOffer, maxPrivateRequestAmount: requestedAmount };
          transactionHash = (await v2.runtime.privateTrade({
            kind: 'fill', orderId: latest.tradeId, expectedRevision: v2.identity.revision, terms
          })).transactionHash;
        }
        return { txHash: transactionHash, refreshDisplay: [
          () => { if (options?.openAfterAction !== false) openTrade(latest.tradeId, undefined, latest.escrowContract); },
          () => refreshOneOffV2Trades?.()
        ] };
      }
    });
  }, [
    ensureTradeFunding,
    notify,
    openTrade,
    readTradeDetail,
    refreshOneOffV2Trades,
    rememberTradeTerminalReturn,
    requireV2,
    runPrivateBookReview,
    runAction,
    setTradeActionError,
    walletAddress
  ]);

  const cancelTrade = useCallback(async (snapshot: TradeSnapshot) => {
    await runAction({
      action: 'cancel',
      snapshot,
      operation: async (markPending) => {
        rememberTradeTerminalReturn(snapshot.tradeId, undefined, snapshot.escrowContract);
        const v2 = await requireV2(snapshot);
        if (v2.identity.protocol === 'private-v2' && isPrivateBookV2RuntimeHash(v2.runtime.deployments['private-v2'].runtimeBytecodeHash)) {
          const confirmed = await runPrivateBookReview(v2.runtime, snapshot, { kind: 'cancel', orderId: snapshot.tradeId }, markPending);
          return { txHash: confirmed.transactionHash, refreshDisplay: [() => refreshOneOffV2Trades?.()] };
        }
        const confirmation = buildOtcV2ConfirmationDetails({
          cotiPrivateInputCount: 0,
          summaryRows: [{ label: 'Order', value: `#${snapshot.tradeId}` }]
        });
        await ensureTradeFunding?.({
          actionLabel: 'cancel order',
          confirmButtonLabel: 'Cancel order',
          confirmMessage: confirmation.confirmMessage,
          confirmationPolicy: 'always',
          confirmationStats: confirmation.confirmationStats,
          confirmTitle: 'Confirm cancellation',
          requirements: [],
          tradeSummary: confirmation.tradeSummary
        });
        markPending();
        const confirmed = v2.identity.protocol === 'standard-v2'
          ? await v2.runtime.standard({ kind: 'cancel', tradeId: snapshot.tradeId })
          : v2.identity.protocol === 'private-v2'
            ? await v2.runtime.privateTrade({ kind: 'cancel', orderId: snapshot.tradeId })
            : await v2.runtime.direct({ kind: 'cancel', tradeId: snapshot.tradeId });
        return { txHash: confirmed.transactionHash, refreshDisplay: [
          () => mergeTradeSnapshot({ ...snapshot, status: 'cancelled' }),
          () => refreshOneOffV2Trades?.()
        ] };
      }
    });
  }, [
    ensureTradeFunding,
    mergeTradeSnapshot,
    refreshOneOffV2Trades,
    rememberTradeTerminalReturn,
    requireV2,
    runPrivateBookReview,
    runAction
  ]);

  const changePrivateBookBudgetVisibility = useCallback(async (snapshot: TradeSnapshot, visible: boolean) => {
    if (otcV2ActionRuntime?.privateBook?.budgetVisibilityAvailable !== true || snapshot.v2?.protocol !== 'private-v2' || !getPrivateBookV2Projection(snapshot)) {
      const message = 'Budget visibility is unavailable.'; setTradeActionError(message);
      notify({ action: 'budget-visibility', status: 'error', tradeKey: snapshotKey(snapshot), message }); return;
    }
    try {
      const selected = await requireV2(snapshot);
      if (selected.runtime.privateBook?.budgetVisibilityAvailable !== true) throw new Error('Budget visibility is unavailable.');
    } catch {
      const message = 'Budget visibility is unavailable.'; setTradeActionError(message);
      notify({ action: 'budget-visibility', status: 'error', tradeKey: snapshotKey(snapshot), message }); return;
    }
    await runAction({ action: 'budget-visibility', snapshot, operation: async markPending => {
      const latest = await readTradeDetail(snapshot.tradeId, snapshot.escrowContract);
      if (!latest || latest.tradeId !== snapshot.tradeId || latest.escrowContract?.toLowerCase() !== snapshot.escrowContract?.toLowerCase()) {
        throw new Error('Refresh the current Book order before changing budget visibility.');
      }
      const v2 = await requireV2(latest), projection = getPrivateBookV2Projection(latest);
      if (v2.identity.protocol !== 'private-v2' || !projection || !walletAddress || latest.maker.toLowerCase() !== walletAddress.toLowerCase()) {
        throw new Error('Only the maker can change this Book budget visibility.');
      }
      if (latest.status !== 'open' || !latest.v2?.revision || latest.v2.revision !== snapshot.v2?.revision) {
        throw new Error('Book revision changed. Refresh the order before changing budget visibility.');
      }
      if (typeof visible !== 'boolean' || typeof projection.publicBudgetVisibility !== 'boolean') {
        throw new Error('Budget visibility is unavailable. Refresh the order.');
      }
      if (projection.publicBudgetVisibility === visible) {
        notify({ action: 'budget-visibility', status: 'info', tradeKey: snapshotKey(latest), message: 'Budget visibility is unchanged.' });
        return undefined;
      }
      const confirmed = await runPrivateBookReview(v2.runtime, latest,
        { kind: 'budget-visibility', orderId: latest.tradeId, expectedRevision: latest.v2.revision, visible }, markPending);
      return { txHash: confirmed.transactionHash, refreshDisplay: [() => refreshOneOffV2Trades?.()] };
    } });
  }, [notify, otcV2ActionRuntime, readTradeDetail, refreshOneOffV2Trades, requireV2, runAction, runPrivateBookReview, setTradeActionError, walletAddress]);

  const declineTrade = useCallback(async (snapshot: TradeSnapshot) => {
    await runAction({
      action: 'decline',
      snapshot,
      operation: async (markPending) => {
        rememberTradeTerminalReturn(snapshot.tradeId, undefined, snapshot.escrowContract);
        const v2 = await requireV2(snapshot);
        if (v2.identity.protocol !== 'direct-v2') {
          throw new Error('Only Direct OTC V2 offers can be declined.');
        }
        const confirmation = buildOtcV2ConfirmationDetails({
          cotiPrivateInputCount: 0,
          summaryRows: [{ label: 'Offer', value: `#${snapshot.tradeId}` }]
        });
        await ensureTradeFunding?.({
          actionLabel: 'refuse offer',
          confirmButtonLabel: 'Refuse offer',
          confirmMessage: confirmation.confirmMessage,
          confirmationPolicy: 'always',
          confirmationStats: confirmation.confirmationStats,
          confirmTitle: 'Confirm refusal',
          requirements: [],
          tradeSummary: confirmation.tradeSummary
        });
        markPending();
        const confirmed = await v2.runtime.direct({ kind: 'decline', tradeId: snapshot.tradeId });
        return { txHash: confirmed.transactionHash, refreshDisplay: [
          () => mergeTradeSnapshot({ ...snapshot, status: 'declined' }),
          () => refreshOneOffV2Trades?.()
        ] };
      }
    });
  }, [
    ensureTradeFunding,
    mergeTradeSnapshot,
    refreshOneOffV2Trades,
    rememberTradeTerminalReturn,
    requireV2,
    runAction
  ]);

  return { acceptTrade, cancelTrade, changePrivateBookBudgetVisibility, declineTrade, partialFillTrade, processingTradeActionId };
}
