import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getProviderErrorMessage } from '../../../lib/appShared/core';
import {
  captureDexV2ActionIntent,
  type DexV2ActionIntent
} from '../../../lib/dexV2Actions';
import {
  confirmDexV2Swap,
  submitDexV2Swap,
  type ConfirmedDexV2Swap
} from '../../../lib/dexV2SwapExecution';
import {
  ensureDexV2InputAllowance,
  isDexV2AllowancePrivacyRefreshRequired,
  type DexV2AllowanceStage
} from '../../../lib/dexV2PrivateToken';
import {
  formatDexV2LotsAsTokenAmount,
  parseDexV2TokenAmountToLots,
  quoteDexV2LimitOutputLots,
  type DexV2SwapDirection
} from '../../../lib/dexV2Terms';
import type { TradeActionConfirmModel } from '../../../lib/tradeActionConfirm';
import type { SharedWalletSession } from '../../../lib/walletSession';
import type { DexV2RuntimeState } from './useDexV2Runtime';

export type DexV2SwapActionStage =
  | 'idle'
  | 'connecting-wallet'
  | 'switching-network'
  | 'unlocking-privacy'
  | 'setting-up-token'
  | 'refreshing-allowance'
  | 'approving-token'
  | 'signing'
  | 'pending'
  | 'success'
  | 'no-match'
  | 'uncertain'
  | 'error';

type ActionState = Readonly<{
  scopeKey: string;
  stage: DexV2SwapActionStage;
  message: string;
  transactionHash?: string;
  confirmed?: ConfirmedDexV2Swap;
}>;

const IDLE: ActionState = Object.freeze({ scopeKey: '', stage: 'idle', message: '' });
const MINIMUM_PERCENTAGES = new Set([0, 25, 50, 100]);

const minimumLotsForPercent = (maximum: bigint, percentage: number): bigint => {
  if (!MINIMUM_PERCENTAGES.has(percentage)) throw new Error('DEX V2 minimum-fill percentage is invalid.');
  return percentage === 0 ? 0n : (maximum * BigInt(percentage) + 99n) / 100n;
};

const actionError = (error: unknown): string => {
  const message = getProviderErrorMessage(error, 'The private DEX swap could not be completed.');
  if (/allowance|transfer amount exceeds|transferFrom/iu.test(message)) {
    return 'The input token has not approved enough private allowance for DEX Core yet.';
  }
  if (/transaction did not succeed|execution reverted/iu.test(message)) {
    return 'The private swap reverted. Refresh the finalized Pool state and review the route again.';
  }
  return message;
};

export default function useDexV2SwapAction({
  amount,
  direction,
  minimumPercent,
  reviewContext,
  requestConfirmation,
  runtime,
  sharedWalletSession,
  tickRank,
  refresh
}: {
  amount: string;
  direction: DexV2SwapDirection;
  minimumPercent: number;
  reviewContext: Readonly<{
    actionLabel: string;
    boundaryKind: string;
    boundaryValue: string;
    inputSymbol: string;
    outputSymbol: string;
  }>;
  requestConfirmation: (confirmation: TradeActionConfirmModel) => Promise<boolean>;
  runtime: DexV2RuntimeState;
  sharedWalletSession?: SharedWalletSession;
  tickRank: number;
  refresh: () => void;
}) {
  const quote = useMemo(() => {
    if (runtime.status !== 'ready') return Object.freeze({ error: '', value: null });
    try {
      const pair = runtime.deployment.manifest.pair;
      const inputIsBase = direction === 'base-to-quote';
      const inputDecimals = inputIsBase ? pair.baseDecimals : pair.quoteDecimals;
      const outputDecimals = inputIsBase ? pair.quoteDecimals : pair.baseDecimals;
      const inputLotSize = BigInt(inputIsBase ? pair.baseLotSize : pair.quoteLotSize);
      const outputLotSize = BigInt(inputIsBase ? pair.quoteLotSize : pair.baseLotSize);
      const maximumInputLots = parseDexV2TokenAmountToLots(amount, inputDecimals, inputLotSize);
      if (maximumInputLots > BigInt(pair.maximumAggregateLots)) {
        throw new Error('Amount exceeds this pair’s reviewed aggregate-lot ceiling.');
      }
      const minimumInputFilledLots = minimumLotsForPercent(maximumInputLots, minimumPercent);
      const estimatedOutputLots = quoteDexV2LimitOutputLots(maximumInputLots, tickRank, direction);
      return Object.freeze({
        error: '',
        value: Object.freeze({
          maximumInputLots,
          minimumInputFilledLots,
          estimatedOutputLots,
          estimatedOutput: formatDexV2LotsAsTokenAmount(estimatedOutputLots, outputDecimals, outputLotSize),
          inputSymbol: inputIsBase ? 'pUSDC' : 'pUSDT',
          outputSymbol: inputIsBase ? 'pUSDT' : 'pUSDC',
          inputDecimals,
          outputDecimals,
          inputLotSize,
          outputLotSize
        })
      });
    } catch (error) {
      return Object.freeze({ error: actionError(error), value: null });
    }
  }, [amount, direction, minimumPercent, runtime, tickRank]);
  const scopeKey = runtime.status === 'ready' && quote.value
    ? [
        runtime.deployment.manifest.manifestHash,
        runtime.deployment.attestationBlock.number,
        sharedWalletSession?.walletAddress.trim().toLowerCase() ?? '',
        direction,
        tickRank,
        quote.value.maximumInputLots,
        quote.value.minimumInputFilledLots
      ].join(':')
    : '';
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const activeRef = useRef(false);
  const recoveryRef = useRef<Readonly<{
    scopeKey: string;
    transactionHash: string;
    confirm: () => Promise<ConfirmedDexV2Swap>;
  }> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<ActionState>(IDLE);
  const visibleState = state.scopeKey === scopeKey ? state : IDLE;

  useEffect(() => () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, []);

  const scheduleFinalizedRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(refresh, 30_000);
  }, [refresh]);

  const showConfirmed = useCallback((confirmed: ConfirmedDexV2Swap, capturedScope: string) => {
    if (scopeRef.current !== capturedScope || !quote.value) return;
    const inputUsed = formatDexV2LotsAsTokenAmount(
      BigInt(confirmed.inputUsedLots),
      quote.value.inputDecimals,
      quote.value.inputLotSize
    );
    const outputAmount = formatDexV2LotsAsTokenAmount(
      BigInt(confirmed.outputAmountLots),
      quote.value.outputDecimals,
      quote.value.outputLotSize
    );
    recoveryRef.current = null;
    setState(Object.freeze({
      scopeKey: capturedScope,
      stage: confirmed.invalid ? 'no-match' : 'success',
      message: confirmed.invalid
        ? 'No eligible liquidity matched. The full private input remained in your wallet.'
        : `Swapped ${inputUsed} ${quote.value.inputSymbol} for ${outputAmount} ${quote.value.outputSymbol}.`,
      transactionHash: confirmed.transactionHash,
      confirmed
    }));
    scheduleFinalizedRefresh();
  }, [quote.value, scheduleFinalizedRefresh]);

  const review = useCallback(async () => {
    const walletActions = sharedWalletSession?.actions;
    if (activeRef.current || runtime.status !== 'ready' || !walletActions) return;
    const walletAddress = sharedWalletSession.walletAddress.trim();
    if (!walletAddress) {
      activeRef.current = true;
      setState(Object.freeze({ scopeKey, stage: 'connecting-wallet', message: 'Opening the browser wallet…' }));
      try {
        await walletActions.connectBrowserWallet(undefined, { preparePrivacy: true });
      } catch (error) {
        setState(Object.freeze({ scopeKey, stage: 'error', message: actionError(error) }));
      } finally {
        activeRef.current = false;
      }
      return;
    }
    if (sharedWalletSession.chainId !== Number(runtime.deployment.manifest.chainId)) {
      activeRef.current = true;
      setState(Object.freeze({ scopeKey, stage: 'switching-network', message: 'Switching the wallet to COTI Testnet…' }));
      try {
        await walletActions.runWalletTransactionFlow(() => walletActions.getSigner(false));
      } catch (error) {
        setState(Object.freeze({ scopeKey, stage: 'error', message: actionError(error) }));
      } finally {
        activeRef.current = false;
      }
      return;
    }
    if (!quote.value || !scopeKey) return;
    const capturedScope = scopeKey;
    const inputAmount = amount;
    const intent: DexV2ActionIntent = captureDexV2ActionIntent({
      kind: 'swap',
      direction,
      limitTickRank: tickRank,
      deadline: BigInt(Math.floor(Date.now() / 1_000) + 60 * 60),
      maximumInputLots: quote.value.maximumInputLots,
      minimumInputFilledLots: quote.value.minimumInputFilledLots
    });
    const accepted = await requestConfirmation(Object.freeze({
      title: 'Review private swap',
      message: 'Your wallet is next. The receive amount is indicative; exact spent, received, and returned amounts appear in the private receipt after confirmation.',
      primaryLabel: 'Continue to wallet',
      fundingMoves: [],
      summaryRows: [
        { label: 'Action', value: reviewContext.actionLabel },
        { label: 'Maximum spend', value: `${inputAmount} ${reviewContext.inputSymbol}` },
        { label: 'Indicative receive', value: `${quote.value.estimatedOutput} ${reviewContext.outputSymbol}` },
        { label: 'Minimum fill', value: minimumPercent === 0 ? 'Any available amount' : `${minimumPercent}%` },
        { label: reviewContext.boundaryKind, value: reviewContext.boundaryValue }
      ],
      stats: [
        { label: 'Status', value: 'Wallet next' },
        { label: 'Route', value: '8 sources max' },
        { label: 'Amounts', value: 'Private' },
        { label: 'Settlement', value: 'After 5 confirmations' }
      ]
    }));
    if (!accepted || scopeRef.current !== capturedScope) return;
    activeRef.current = true;
    setState(Object.freeze({
      scopeKey: capturedScope,
      stage: 'unlocking-privacy',
      message: 'Unlocking the wallet privacy key…'
    }));
    try {
      const confirmed = await walletActions.runWalletTransactionFlow(async () => {
        let signer = await walletActions.getSigner(true);
        if (scopeRef.current !== capturedScope) {
          throw new Error('The DEX review inputs changed before signing. Review them again.');
        }
        const updateAllowanceStage = (stage: DexV2AllowanceStage) => setState(Object.freeze({
          scopeKey: capturedScope,
          stage,
          message: stage === 'setting-up-token'
            ? `Setting up ${quote.value.inputSymbol} for this privacy account…`
            : stage === 'refreshing-allowance'
              ? 'Refreshing the private-token allowance ciphertext…'
              : `Confirm the ${quote.value.inputSymbol} allowance in your wallet…`
        }));
        const ensureAllowance = () => ensureDexV2InputAllowance({
          deployment: runtime.deployment,
          inputToken: direction === 'base-to-quote'
            ? runtime.deployment.manifest.pair.baseToken
            : runtime.deployment.manifest.pair.quoteToken,
          maximumInputLots: quote.value.maximumInputLots,
          signer,
          onStage: updateAllowanceStage
        });
        try {
          await ensureAllowance();
        } catch (error) {
          if (!isDexV2AllowancePrivacyRefreshRequired(error)) throw error;
          setState(Object.freeze({
            scopeKey: capturedScope,
            stage: 'unlocking-privacy',
            message: 'Refreshing the wallet privacy key for this allowance…'
          }));
          signer = await walletActions.getSigner(true, { refreshAes: true });
          if (scopeRef.current !== capturedScope) {
            throw new Error('The DEX quote changed while refreshing privacy. Review it again.');
          }
          await ensureAllowance();
        }
        if (scopeRef.current !== capturedScope) {
          throw new Error('The DEX quote changed before signing. Review it again.');
        }
        setState(Object.freeze({
          scopeKey: capturedScope,
          stage: 'signing',
          message: 'Confirm the private routed swap in your wallet…'
        }));
        const submission = await submitDexV2Swap({
          deployment: runtime.deployment,
          intent,
          signer
        });
        const recovery = Object.freeze({
          scopeKey: capturedScope,
          transactionHash: submission.submittedTransactionHash,
          confirm: () => confirmDexV2Swap({ deployment: runtime.deployment, signer, submission })
        });
        recoveryRef.current = recovery;
        setState(Object.freeze({
          scopeKey: capturedScope,
          stage: 'pending',
          message: 'Transaction submitted. Waiting for five confirmations and the private receipt…',
          transactionHash: submission.submittedTransactionHash
        }));
        return recovery.confirm();
      });
      showConfirmed(confirmed, capturedScope);
    } catch (error) {
      if (scopeRef.current === capturedScope) {
        const recovery = recoveryRef.current?.scopeKey === capturedScope ? recoveryRef.current : null;
        setState(Object.freeze({
          scopeKey: capturedScope,
          stage: recovery ? 'uncertain' : 'error',
          message: recovery
            ? 'The transaction was submitted, but its private receipt is not available yet. Check the explorer, then retry receipt recovery.'
            : actionError(error),
          transactionHash: recovery?.transactionHash
        }));
      }
    } finally {
      activeRef.current = false;
    }
  }, [
    amount,
    direction,
    minimumPercent,
    quote.value,
    reviewContext,
    requestConfirmation,
    runtime,
    showConfirmed,
    scopeKey,
    sharedWalletSession,
    tickRank
  ]);

  const recover = useCallback(async () => {
    const recovery = recoveryRef.current;
    if (!recovery || recovery.scopeKey !== scopeKey || activeRef.current) return;
    activeRef.current = true;
    setState(Object.freeze({
      scopeKey,
      stage: 'pending',
      message: 'Retrying the confirmed private receipt…',
      transactionHash: recovery.transactionHash
    }));
    try {
      showConfirmed(await recovery.confirm(), scopeKey);
    } catch {
      setState(Object.freeze({
        scopeKey,
        stage: 'uncertain',
        message: 'The private receipt is still unavailable. The submitted transaction was not sent again.',
        transactionHash: recovery.transactionHash
      }));
    } finally {
      activeRef.current = false;
    }
  }, [scopeKey, showConfirmed]);

  const busy = [
    'connecting-wallet',
    'switching-network',
    'unlocking-privacy',
    'setting-up-token',
    'refreshing-allowance',
    'approving-token',
    'signing',
    'pending'
  ].includes(visibleState.stage);
  const walletActionsAvailable = Boolean(sharedWalletSession?.actions);
  const walletAddress = sharedWalletSession?.walletAddress.trim() ?? '';
  const walletOnDexChain = runtime.status === 'ready' &&
    sharedWalletSession?.chainId === Number(runtime.deployment.manifest.chainId);
  const buttonLabel = runtime.status !== 'ready'
    ? runtime.status === 'attesting'
      ? 'Verifying live state'
      : runtime.status === 'error'
        ? 'Live verification unavailable'
        : runtime.status === 'invalid'
          ? 'Configuration invalid'
          : 'Activation required'
    : !walletActionsAvailable
      ? 'Wallet unavailable'
      : !walletAddress
        ? 'Connect wallet'
        : !walletOnDexChain
          ? 'Switch to COTI Testnet'
          : busy
            ? visibleState.message
            : visibleState.stage === 'uncertain'
              ? 'Retry receipt recovery'
            : quote.error
              ? 'Check swap amount'
              : 'Review private swap';

  return Object.freeze({
    quote: quote.value,
    quoteError: quote.error,
    stage: visibleState.stage,
    message: visibleState.message,
    confirmed: visibleState.confirmed ?? null,
    transactionHash: visibleState.transactionHash ?? '',
    receiptStatus: visibleState.stage === 'success' || visibleState.stage === 'no-match'
      ? 'Private receipt available'
      : visibleState.stage === 'pending'
        ? 'Pending confirmation'
        : visibleState.stage === 'uncertain'
          ? 'Private receipt unavailable'
          : visibleState.stage === 'error'
            ? 'Failed before submission'
            : 'Not submitted',
    busy,
    buttonLabel,
    canReview: runtime.status === 'ready' && walletActionsAvailable &&
      (!walletAddress || !walletOnDexChain || Boolean(quote.value)) &&
      !busy,
    review,
    recover
  });
}
