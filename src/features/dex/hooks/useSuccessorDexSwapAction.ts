import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getProviderErrorMessage } from '../../../lib/appShared/core';
import {
  formatSuccessorSwapPlanAmount,
  planSuccessorSwap,
  processSuccessorSwapFrame,
  readSuccessorSwapProgress,
  revealSuccessorSwapReceipt,
  findResumableSuccessorSwap,
  withdrawSuccessorSwapCredit,
  submitSuccessorSwap,
  type SuccessorSwapPlan,
  type SuccessorSwapProgress,
  type SuccessorSwapReceipt,
  nextSuccessorSwapAction
} from '../../../lib/successorDexSwap';
import {
  cancelSuccessorP2Intent,
  findResumableSuccessorP2,
  formatSuccessorP2PlanAmount,
  nextSuccessorP2Action,
  planSuccessorP2FallbackFromDirect,
  planSuccessorP2Intent,
  readSuccessorP2Status,
  recoverExpiredSuccessorP2,
  reopenSuccessorP2Work,
  revealSuccessorP2Receipt,
  submitSuccessorP2Intent,
  withdrawSuccessorP2Credit,
  withdrawSuccessorP2WorkCredit,
  type SuccessorP2Plan,
  type SuccessorP2Receipt,
  type SuccessorP2Status
} from '../../../lib/successorDexP2';
import type { TradeActionConfirmModel } from '../../../lib/tradeActionConfirm';
import type { SharedWalletSession } from '../../../lib/walletSession';
import type { TradingPair } from '../../../app/components/TradingProductSwitch';
import type { SuccessorDexRuntimeState } from './useSuccessorDexDeployment';

type DirectPending = Readonly<{
  kind: 'direct';
  requestId: bigint;
  deadline: bigint;
  plan: SuccessorSwapPlan;
  progress: SuccessorSwapProgress;
  maximumKnown: boolean;
  receipt?: SuccessorSwapReceipt;
  settled?: boolean;
  recovered?: boolean;
  inputCreditWithdrawn?: boolean;
  outputCreditWithdrawn?: boolean;
}>;

type P2Pending = Readonly<{
  kind: 'p2';
  intentId: bigint;
  expiry: bigint;
  plan: SuccessorP2Plan;
  status: SuccessorP2Status;
  maximumKnown: boolean;
  receipt?: SuccessorP2Receipt;
  settled?: boolean;
  recovered?: boolean;
  inputCreditWithdrawn?: boolean;
  outputCreditWithdrawn?: boolean;
  workCreditWithdrawn?: boolean;
}>;

type Pending = DirectPending | P2Pending;

type ExhaustedDirectPending = DirectPending & Readonly<{
  receipt: SuccessorSwapReceipt;
}>;

type Quote =
  | Readonly<{ lane: 'direct'; plan: SuccessorSwapPlan; error: '' }>
  | Readonly<{ lane: 'p2'; plan: SuccessorP2Plan; error: '' }>
  | Readonly<{ lane: null; plan: null; error: string }>;

type State = Readonly<{
  stage: 'idle' | 'busy' | 'working' | 'success' | 'no-match' | 'recovered' | 'error';
  message: string;
  transactionHash: string;
  pending: Pending | null;
}>;

const IDLE: State = Object.freeze({ stage: 'idle', message: '', transactionHash: '', pending: null });
const PROGRESS_POLL_MS = 6_000;

const failure = (error: unknown) => getProviderErrorMessage(error, 'The successor Swap action failed.');

const canOpenExhaustedP2 = (pending: Pending | null): pending is ExhaustedDirectPending => Boolean(
  pending?.kind === 'direct' &&
  pending.maximumKnown &&
  pending.settled &&
  pending.progress.workClosed &&
  pending.receipt?.invalid &&
  pending.receipt.directUnavailable &&
  pending.receipt.refund > 0n &&
  !pending.inputCreditWithdrawn
);

const directTerminalMessage = (pending: DirectPending): string => pending.receipt
  ? pending.receipt.invalid
    ? `No direct liquidity matched. ${formatSuccessorSwapPlanAmount(pending.plan, pending.receipt.refund)} ${pending.plan.inputSymbol} was returned as owner credit.${pending.receipt.directUnavailable
      ? ' The authenticated direct snapshot is exhausted. You can open P2 with one separate owner signature after source cleanup.'
      : ' Direct liquidity existed, but protection prevented settlement. P2 is not eligible.'}`
    : `Swapped ${formatSuccessorSwapPlanAmount(pending.plan, pending.receipt.inputUsed)} ${pending.plan.inputSymbol} for ${formatSuccessorSwapPlanAmount(pending.plan, pending.receipt.netOutput, true)} ${pending.plan.outputSymbol}; fee ${formatSuccessorSwapPlanAmount(pending.plan, pending.receipt.fee, true)} ${pending.plan.outputSymbol}.`
  : pending.recovered
    ? pending.maximumKnown
      ? `The expired request was recovered. ${formatSuccessorSwapPlanAmount(pending.plan, pending.plan.maximumInputLots)} ${pending.plan.inputSymbol} is available as owner credit.`
      : `The expired request input is available as owner ${pending.plan.inputSymbol} credit.`
    : '';

const p2TerminalMessage = (pending: P2Pending): string => pending.receipt
  ? pending.receipt.invalid
    ? `No P2 route matched. ${formatSuccessorP2PlanAmount(pending.plan, pending.receipt.refund)} ${pending.plan.inputSymbol} was returned as owner credit.`
    : `Swapped ${formatSuccessorP2PlanAmount(pending.plan, pending.receipt.inputUsed)} ${pending.plan.inputSymbol} for ${formatSuccessorP2PlanAmount(pending.plan, pending.receipt.netOutput, true)} ${pending.plan.outputSymbol}; fee ${formatSuccessorP2PlanAmount(pending.plan, pending.receipt.fee, true)} ${pending.plan.outputSymbol}.`
  : pending.recovered
    ? pending.maximumKnown
      ? `The P2 intent was recovered. ${formatSuccessorP2PlanAmount(pending.plan, pending.plan.maximumInputLots)} ${pending.plan.inputSymbol} is available as owner credit.`
      : `The recovered P2 input is available as owner ${pending.plan.inputSymbol} credit.`
    : '';

const terminalMessage = (pending: Pending): string => pending.kind === 'p2'
  ? p2TerminalMessage(pending)
  : directTerminalMessage(pending);

const terminalStage = (pending: Pending): State['stage'] => pending.receipt
  ? pending.receipt.invalid ? 'no-match' : 'success'
  : pending.recovered ? 'recovered' : 'working';

const pendingDirectTokenCredit = (pending: DirectPending): Readonly<{ token: string; symbol: string; amount?: bigint; output: boolean }> | null => {
  if (!pending.progress.workClosed) return null;
  const inputAmount = pending.receipt?.refund ?? (pending.recovered && pending.maximumKnown
    ? pending.plan.maximumInputLots
    : undefined);
  const hasInputCredit = inputAmount === undefined ? pending.recovered === true : inputAmount > 0n;
  if (!pending.inputCreditWithdrawn && hasInputCredit) {
    return Object.freeze({ token: pending.plan.inputToken, symbol: pending.plan.inputSymbol, amount: inputAmount, output: false });
  }
  const outputAmount = pending.receipt?.netOutput;
  if (!pending.outputCreditWithdrawn && outputAmount !== undefined && outputAmount > 0n) {
    return Object.freeze({ token: pending.plan.outputToken, symbol: pending.plan.outputSymbol, amount: outputAmount, output: true });
  }
  return null;
};

const p2WorkClosed = (pending: P2Pending): boolean => pending.status.workStage === 0 || pending.status.workStage === 7;

const pendingP2TokenCredit = (pending: P2Pending): Readonly<{ token: string; symbol: string; amount?: bigint; output: boolean }> | null => {
  if (!p2WorkClosed(pending)) return null;
  const inputAmount = pending.receipt?.refund ?? (pending.recovered && pending.maximumKnown
    ? pending.plan.maximumInputLots
    : undefined);
  const hasInputCredit = inputAmount === undefined ? pending.recovered === true : inputAmount > 0n;
  if (!pending.inputCreditWithdrawn && hasInputCredit) {
    return Object.freeze({ token: pending.plan.inputToken, symbol: pending.plan.inputSymbol, amount: inputAmount, output: false });
  }
  const outputAmount = pending.receipt?.netOutput ?? 0n;
  if (!pending.outputCreditWithdrawn && outputAmount > 0n) {
    return Object.freeze({ token: pending.plan.outputToken, symbol: pending.plan.outputSymbol, amount: outputAmount, output: true });
  }
  return null;
};

export const selectSuccessorSwapLane = (sourceCount: number): 'direct' | 'p2' =>
  sourceCount === 0 ? 'p2' : 'direct';

export default function useSuccessorDexSwapAction({
  amount,
  direction,
  displayedLimitPrice,
  minimumPercent,
  requestConfirmation,
  runtime,
  selectedPair,
  sharedWalletSession,
  refresh
}: {
  amount: string;
  direction: 'base-to-quote' | 'quote-to-base';
  displayedLimitPrice: number;
  minimumPercent: number;
  requestConfirmation: (confirmation: TradeActionConfirmModel) => Promise<boolean>;
  runtime: SuccessorDexRuntimeState;
  selectedPair: TradingPair;
  sharedWalletSession?: SharedWalletSession;
  refresh: () => void;
}) {
  const active = useRef(false);
  const resumeScope = useRef('');
  const [state, setState] = useState<State>(IDLE);
  const quote = useMemo<Quote>(() => {
    if (runtime.status !== 'ready') return Object.freeze({ lane: null, plan: null, error: '' });
    try {
      const pair = runtime.manifest.pairs.find((item) => item.displayPair === selectedPair.join('/'));
      if (!pair) throw new Error('The selected pair is not in the successor manifest.');
      const lane = selectSuccessorSwapLane(pair.sourceCount);
      return Object.freeze({
        lane,
        plan: lane === 'p2'
          ? planSuccessorP2Intent({
              manifest: runtime.manifest,
              selectedPair,
              direction,
              amount,
              displayedLimitPrice,
              minimumPercent
            })
          : planSuccessorSwap({
              manifest: runtime.manifest,
              selectedPair,
              direction,
              amount,
              displayedLimitPrice,
              minimumPercent
            }),
        error: ''
      }) as Quote;
    } catch (error) {
      return Object.freeze({ lane: null, plan: null, error: failure(error) });
    }
  }, [amount, direction, displayedLimitPrice, minimumPercent, runtime, selectedPair]);

  useEffect(() => {
    const actions = sharedWalletSession?.actions;
    const wallet = sharedWalletSession?.walletAddress.trim() ?? '';
    if (runtime.status !== 'ready' || !actions || !wallet ||
        sharedWalletSession?.chainId !== Number(runtime.manifest.chainId) || state.stage !== 'idle') return;
    const pair = runtime.manifest.pairs.find((item) => item.displayPair === selectedPair.join('/'));
    if (!pair) return;
    const lane = selectSuccessorSwapLane(pair.sourceCount);
    const scope = `${runtime.manifest.releaseIdentityHash}:${wallet.toLowerCase()}:${pair.marketKey}`;
    if (resumeScope.current === scope) return;
    resumeScope.current = scope;
    let cancelled = false;
    void (async () => {
      const signer = await actions.getSigner(false);
      if (lane === 'p2') {
        const resumable = await findResumableSuccessorP2({ signer, manifest: runtime.manifest, pair });
        if (cancelled || !resumable) return;
        setState(Object.freeze({
          stage: resumable.recovered ? 'recovered' : 'working',
          message: `P2 intent #${resumable.intentId} was resumed from COTI Testnet.`,
          transactionHash: '',
          pending: Object.freeze({ kind: 'p2', ...resumable })
        }));
        return;
      }
      const resumable = await findResumableSuccessorSwap({ signer, manifest: runtime.manifest, pair });
      if (cancelled || !resumable) return;
      setState(Object.freeze({
        stage: resumable.recovered ? 'recovered' : 'working',
        message: `Swap request #${resumable.requestId} was resumed from COTI Testnet.`,
        transactionHash: '',
        pending: Object.freeze({ kind: 'direct', ...resumable, maximumKnown: false })
      }));
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [runtime, selectedPair, sharedWalletSession?.actions, sharedWalletSession?.chainId, sharedWalletSession?.walletAddress, state.stage]);

  const pendingIdentity = state.pending
    ? `${state.pending.kind}:${state.pending.kind === 'p2' ? state.pending.intentId : state.pending.requestId}`
    : '';

  useEffect(() => {
    if (!state.pending || runtime.status !== 'ready' || !sharedWalletSession?.actions) return;
    let cancelled = false;
    let refreshing = false;
    let consecutiveFailures = 0;
    const identity = pendingIdentity;
    const refreshProgress = async () => {
      if (cancelled || refreshing || active.current) return;
      refreshing = true;
      try {
        const signer = await sharedWalletSession.actions!.getSigner(false);
        const current = state.pending;
        if (!current || `${current.kind}:${current.kind === 'p2' ? current.intentId : current.requestId}` !== identity) return;
        if (current.kind === 'p2') {
          const status = await readSuccessorP2Status({
            signer,
            manifest: runtime.manifest,
            intentId: current.intentId
          });
          consecutiveFailures = 0;
          if (cancelled) return;
          setState((value) => {
            if (!value.pending || value.pending.kind !== 'p2' || value.pending.intentId !== current.intentId) return value;
            const settled = value.pending.settled || status.intentStatus === 2;
            const recovered = value.pending.recovered || status.intentStatus === 3 || status.intentStatus === 4;
            const pending = Object.freeze({ ...value.pending, status, settled, recovered });
            const action = nextSuccessorP2Action(status);
            const message = value.pending.receipt
              ? terminalMessage(pending)
              : settled
                ? p2WorkClosed(pending)
                  ? `Keeper settled P2 intent #${current.intentId}. Reveal the private receipt when ready.`
                  : `Keeper settled P2 intent #${current.intentId} and is finalizing its source deltas.`
                : recovered
                  ? p2WorkClosed(pending)
                    ? `Keeper recovered P2 intent #${current.intentId}. The owner credits are ready.`
                    : `Keeper recovered P2 intent #${current.intentId} and is finalizing source cleanup.`
                  : action === 'recover-work' || action === 'recover-intent'
                    ? `P2 intent #${current.intentId} expired. Waiting for a permissionless recovery keeper.`
                    : action === 'settle'
                      ? `P2 route work is confirmed. Waiting for keeper settlement.`
                      : action === 'fold'
                        ? `P2 settlement is confirmed. Waiting for keeper finalization.`
                        : `Keeper is processing P2 stage ${status.workStage}, revision ${status.workRevision}.`;
            return Object.freeze({
              ...value,
              stage: value.pending.receipt ? terminalStage(pending) : recovered ? 'recovered' : 'working',
              message,
              pending
            });
          });
          return;
        }
        const requestId = current.requestId;
        const progress = await readSuccessorSwapProgress({
          signer,
          manifest: runtime.manifest,
          pair: current.plan.pair,
          requestId
        });
        consecutiveFailures = 0;
        if (cancelled) return;
        setState((value) => {
          if (!value.pending || value.pending.kind !== 'direct' || value.pending.requestId !== requestId) return value;
          const settled = value.pending.settled || progress.terminalState === 'settled';
          const recovered = value.pending.recovered || progress.terminalState === 'recovered';
          const pending = Object.freeze({ ...value.pending, progress, settled, recovered });
          const message = value.pending.receipt
            ? terminalMessage(pending)
            : settled
              ? `Keeper settled Swap request #${requestId}. Reveal the private receipt when ready.`
              : recovered
                ? progress.workClosed
                  ? `Keeper recovered expired Swap request #${requestId}. The owner credit is ready.`
                  : `Keeper recovered expired Swap request #${requestId} and is finalizing source cleanup.`
                : progress.recoveryCleanup
                  ? `Keeper is cleaning up source ${progress.cleanupCursor + 1} of ${progress.sourceCount}.`
                  : progress.latestBlock >= value.pending.deadline
                    ? `Swap request #${requestId} expired. Waiting for a permissionless recovery keeper.`
                    : progress.workCursor === progress.settlementCursor
                      ? `All ${progress.settlementCursor} frames are confirmed. Waiting for keeper settlement.`
                      : `Keeper progress: ${progress.workCursor} of ${progress.settlementCursor} frames confirmed.`;
          return Object.freeze({
            ...value,
            stage: value.pending.receipt ? terminalStage(pending) : recovered ? 'recovered' : 'working',
            message,
            pending
          });
        });
      } catch {
        consecutiveFailures = Math.min(consecutiveFailures + 1, 3);
        if (consecutiveFailures === 3 && !cancelled) {
          setState((value) => value.pending && `${value.pending.kind}:${value.pending.kind === 'p2' ? value.pending.intentId : value.pending.requestId}` === identity
            ? Object.freeze({
                ...value,
                message: 'On-chain status refresh failed three times. The confirmed request remains saved, and polling continues.'
              })
            : value);
        }
      } finally {
        refreshing = false;
      }
    };
    void refreshProgress();
    const timer = window.setInterval(() => { void refreshProgress(); }, PROGRESS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pendingIdentity, runtime, sharedWalletSession?.actions]);

  const process = useCallback(async () => {
    const pending = state.pending;
    const actions = sharedWalletSession?.actions;
    if (!pending || !actions || runtime.status !== 'ready' || active.current) return;
    if (canOpenExhaustedP2(pending)) {
      const accepted = await requestConfirmation(Object.freeze({
        title: 'Review private P2 fallback',
        message: 'The participant-only direct receipt proves that the complete direct snapshot had no executable liquidity. P2 uses the existing Core credit, needs no new token allowance, and requires one separate owner signature.',
        primaryLabel: 'Open P2 fallback',
        fundingMoves: [],
        summaryRows: [
          { label: 'Maximum spend', value: `${formatSuccessorSwapPlanAmount(pending.plan, pending.plan.maximumInputLots)} ${pending.plan.inputSymbol}` },
          { label: 'Minimum receive', value: pending.plan.minimumOutputLots === 0n
            ? 'Any protected output'
            : `${formatSuccessorSwapPlanAmount(pending.plan, pending.plan.minimumOutputLots, true)} ${pending.plan.outputSymbol}` },
          { label: 'Funding', value: 'Existing direct Swap credit' },
          { label: 'Authorization', value: 'Separate P2 owner signature' }
        ],
        stats: [
          { label: 'Direct book', value: 'Authenticated exhausted' },
          { label: 'Routes', value: '2 padded' },
          { label: 'New allowance', value: 'None' }
        ]
      }));
      if (!accepted) return;
    }
    active.current = true;
    setState((current) => Object.freeze({ ...current, stage: 'busy', message: 'Confirm the owner action in your wallet…' }));
    try {
      await actions.runWalletTransactionFlow(async () => {
        const signer = await actions.getSigner(true);
        if (pending.kind === 'p2') {
          const lifecycleAction = nextSuccessorP2Action(pending.status);
          if (lifecycleAction === 'reopen') {
            const reopened = await reopenSuccessorP2Work({ signer, manifest: runtime.manifest, status: pending.status });
            const next = Object.freeze({ ...pending, status: reopened.status, settled: false, recovered: false });
            setState(Object.freeze({
              stage: 'working',
              message: `P2 intent #${pending.intentId} route work was reopened. A permissionless keeper can continue it.`,
              transactionHash: reopened.transactionHash,
              pending: next
            }));
            return;
          }
          if (lifecycleAction === 'recover-work' || lifecycleAction === 'recover-intent') {
            const recovery = await recoverExpiredSuccessorP2({
              signer,
              manifest: runtime.manifest,
              status: pending.status
            });
            const recovered = recovery.action === 'recover-intent' || pending.recovered === true;
            const next = Object.freeze({ ...pending, status: recovery.status, recovered });
            setState(Object.freeze({
              stage: recovered ? 'recovered' : 'working',
              message: recovery.action === 'recover-intent'
                ? `${p2TerminalMessage(next)} Withdraw the owner credits.`
                : `Expired P2 work for intent #${pending.intentId} was recovered. Recover the intent input next.`,
              transactionHash: recovery.transactionHash,
              pending: next
            }));
            return;
          }
          if (pending.settled && p2WorkClosed(pending) && !pending.receipt) {
            const receipt = await revealSuccessorP2Receipt({
              signer,
              manifest: runtime.manifest,
              intentId: pending.intentId
            });
            const next = Object.freeze({ ...pending, receipt });
            setState(Object.freeze({
              stage: receipt.invalid ? 'no-match' : 'success',
              message: `${terminalMessage(next)} Withdraw the owner credits.`,
              transactionHash: state.transactionHash,
              pending: next
            }));
            return;
          }
          const credit = pendingP2TokenCredit(pending);
          if (credit) {
            const withdrawal = await withdrawSuccessorP2Credit({
              signer,
              manifest: runtime.manifest,
              tokenAddress: credit.token,
              amountLots: credit.amount
            });
            const creditComplete = credit.amount !== undefined || withdrawal.remainingLots === 0n;
            const next = Object.freeze({
              ...pending,
              inputCreditWithdrawn: credit.output || !creditComplete ? pending.inputCreditWithdrawn : true,
              outputCreditWithdrawn: !credit.output || !creditComplete ? pending.outputCreditWithdrawn : true
            });
            const finished = !pendingP2TokenCredit(next) &&
              (next.status.workCredit === 0n || next.workCreditWithdrawn === true);
            setState(Object.freeze({
              stage: terminalStage(next),
              message: `${terminalMessage(next)} ${withdrawal.amountLots === 0n
                ? `No remaining ${credit.symbol} Core credit.`
                : `Withdrew ${formatSuccessorP2PlanAmount(next.plan, withdrawal.amountLots, credit.output)} ${credit.symbol} from Core credit.`}`.trim(),
              transactionHash: withdrawal.transactionHash || state.transactionHash,
              pending: finished ? null : next
            }));
            refresh();
            return;
          }
          if (p2WorkClosed(pending) && pending.status.workCredit > 0n && !pending.workCreditWithdrawn) {
            const withdrawal = await withdrawSuccessorP2WorkCredit({ signer, manifest: runtime.manifest });
            const next = Object.freeze({
              ...pending,
              status: Object.freeze({ ...pending.status, workCredit: 0n }),
              workCreditWithdrawn: true
            });
            setState(Object.freeze({
              stage: terminalStage(next),
              message: `${terminalMessage(next)} Withdrew ${withdrawal.amount} wei of unused keeper work credit.`.trim(),
              transactionHash: withdrawal.transactionHash,
              pending: pendingP2TokenCredit(next) ? next : null
            }));
            refresh();
          }
          return;
        }
        if (pending.settled && !pending.receipt) {
          const receipt = await revealSuccessorSwapReceipt({
            signer,
            manifest: runtime.manifest,
            requestId: pending.requestId
          });
          const next = Object.freeze({ ...pending, receipt });
          setState(Object.freeze({
            stage: receipt.invalid ? 'no-match' : 'success',
            message: `${terminalMessage(next)} ${pending.progress.workClosed
              ? 'Withdraw the owner credits.'
              : `Finalize ${next.plan.pair.sourceCount} source ${next.plan.pair.sourceCount === 1 ? 'delta' : 'deltas'}.`}`,
            transactionHash: state.transactionHash,
            pending: next
          }));
          return;
        }
        if (canOpenExhaustedP2(pending)) {
          const plan = planSuccessorP2FallbackFromDirect({
            directPlan: pending.plan,
            directUnavailable: pending.receipt.directUnavailable
          });
          const submission = await submitSuccessorP2Intent({ signer, manifest: runtime.manifest, plan });
          setState(Object.freeze({
            stage: 'working',
            message: `P2 intent #${submission.intentId} is open from the authenticated exhausted-direct credit. A permissionless keeper is processing its padded route work.`,
            transactionHash: submission.transactionHash,
            pending: Object.freeze({
              kind: 'p2',
              intentId: submission.intentId,
              expiry: submission.expiry,
              plan,
              status: submission.status,
              maximumKnown: true
            })
          }));
          return;
        }
        const credit = pendingDirectTokenCredit(pending);
        if (credit) {
          const withdrawal = await withdrawSuccessorSwapCredit({
            signer,
            manifest: runtime.manifest,
            token: credit.token,
            amountLots: credit.amount
          });
          const next = Object.freeze({
            ...pending,
            inputCreditWithdrawn: credit.output ? pending.inputCreditWithdrawn : true,
            outputCreditWithdrawn: credit.output ? true : pending.outputCreditWithdrawn
          });
          const moreCredit = pendingDirectTokenCredit(next);
          const finished = !moreCredit && pending.progress.workCredit === 0n;
          setState(Object.freeze({
            stage: terminalStage(next),
            message: `${terminalMessage(next)} ${withdrawal.amountLots === 0n
              ? `No remaining ${credit.symbol} Core credit.`
                : `Withdrew ${formatSuccessorSwapPlanAmount(pending.plan, withdrawal.amountLots, credit.output)} ${credit.symbol} from Core credit.`}`.trim(),
            transactionHash: withdrawal.transactionHash || state.transactionHash,
            pending: finished ? null : next
          }));
          refresh();
          return;
        }
        const result = await processSuccessorSwapFrame({
          signer,
          manifest: runtime.manifest,
          pair: pending.plan.pair,
          requestId: pending.requestId,
          deadline: pending.deadline
        });
        if (result.action === 'advance') {
          setState(Object.freeze({
            stage: 'working',
            message: `Work frame ${result.progress.workCursor} of ${result.progress.settlementCursor} is confirmed.`,
            transactionHash: result.transactionHash,
            pending: Object.freeze({ ...pending, progress: result.progress })
          }));
          return;
        }
        if (result.action === 'settle') {
          const receipt = await revealSuccessorSwapReceipt({
            signer,
            manifest: runtime.manifest,
            requestId: pending.requestId,
            maximumInputLots: pending.maximumKnown ? pending.plan.maximumInputLots : undefined
          });
          const next = Object.freeze({ ...pending, progress: result.progress, receipt, settled: true });
          setState(Object.freeze({
            stage: receipt.invalid ? 'no-match' : 'success',
            message: `${terminalMessage(next)} Finalize ${next.plan.pair.sourceCount} source ${next.plan.pair.sourceCount === 1 ? 'delta' : 'deltas'}.`,
            transactionHash: result.transactionHash,
            pending: next
          }));
          refresh();
          return;
        }
        if (result.action === 'recover') {
          const next = Object.freeze({ ...pending, progress: result.progress, recovered: true });
          setState(Object.freeze({
            stage: 'recovered',
            message: `${terminalMessage(next)} Clean up ${next.plan.pair.sourceCount} reserved ${next.plan.pair.sourceCount === 1 ? 'source' : 'sources'}.`,
            transactionHash: result.transactionHash,
            pending: next
          }));
          refresh();
          return;
        }
        const next = Object.freeze({ ...pending, progress: result.progress });
        const finished = result.action === 'complete' || result.progress.workClosed && result.progress.workCredit === 0n;
        const prefix = terminalMessage(next);
        setState(Object.freeze({
          stage: terminalStage(next),
          message: result.action === 'withdraw-credit'
            ? `${prefix} Work credit withdrawn.`.trim()
            : result.progress.workClosed
              ? `${prefix} ${result.progress.workCredit === 0n ? 'Work lifecycle complete.' : 'Source cleanup is complete. Withdraw the work credit.'}`.trim()
              : `${prefix} Source cleanup ${result.progress.cleanupCursor} of ${result.progress.sourceCount} is confirmed.`.trim(),
          transactionHash: result.transactionHash || state.transactionHash,
          pending: finished ? null : next
        }));
        refresh();
      });
    } catch (error) {
      setState((current) => Object.freeze({ ...current, stage: 'error', message: failure(error) }));
    } finally {
      active.current = false;
    }
  }, [refresh, requestConfirmation, runtime, sharedWalletSession?.actions, state.pending, state.transactionHash]);

  const pendingAction = state.pending?.kind === 'direct'
    ? nextSuccessorSwapAction({
        progress: state.pending.progress,
        deadline: state.pending.deadline,
        currentBlock: state.pending.progress.latestBlock
      })
    : state.pending?.kind === 'p2'
      ? nextSuccessorP2Action(state.pending.status)
      : null;
  const tokenCredit = state.pending?.kind === 'p2'
    ? pendingP2TokenCredit(state.pending)
    : state.pending?.kind === 'direct'
      ? pendingDirectTokenCredit(state.pending)
      : null;
  const canReveal = Boolean(state.pending?.settled && !state.pending.receipt &&
    (state.pending.kind === 'direct' || p2WorkClosed(state.pending)));
  const p2WorkCreditAvailable = Boolean(state.pending?.kind === 'p2' && p2WorkClosed(state.pending) &&
    state.pending.status.workCredit > 0n && !state.pending.workCreditWithdrawn);
  const p2FallbackAvailable = canOpenExhaustedP2(state.pending);
  const canCancelP2 = Boolean(state.pending?.kind === 'p2' &&
    state.pending.status.intentStatus === 1 &&
    state.pending.status.latestTimestamp < state.pending.expiry &&
    (sharedWalletSession?.walletAddress.trim().toLowerCase() ?? '') === state.pending.status.owner.toLowerCase());
  const ownerActionAvailable = Boolean(state.pending && (
    canReveal ||
    p2FallbackAvailable ||
    tokenCredit ||
    pendingAction === 'withdraw-credit' ||
    pendingAction === 'reopen' ||
    pendingAction === 'recover-work' ||
    pendingAction === 'recover-intent' ||
    p2WorkCreditAvailable
  ));

  const cancelP2 = useCallback(async () => {
    const pending = state.pending;
    const actions = sharedWalletSession?.actions;
    if (!canCancelP2 || !pending || pending.kind !== 'p2' || !actions ||
        runtime.status !== 'ready' || active.current) return;
    active.current = true;
    setState((current) => Object.freeze({ ...current, stage: 'busy', message: 'Confirm P2 cancellation in your wallet…' }));
    try {
      await actions.runWalletTransactionFlow(async () => {
        const signer = await actions.getSigner(true);
        const cancellation = await cancelSuccessorP2Intent({
          signer,
          manifest: runtime.manifest,
          status: pending.status
        });
        const next = Object.freeze({ ...pending, status: cancellation.status, recovered: true });
        setState(Object.freeze({
          stage: 'recovered',
          message: p2WorkClosed(next)
            ? `${p2TerminalMessage(next)} Withdraw the owner credit.`
            : `P2 intent #${pending.intentId} was cancelled. A permissionless keeper must recover its open work before withdrawal.`,
          transactionHash: cancellation.transactionHash,
          pending: next
        }));
      });
    } catch (error) {
      setState((current) => Object.freeze({ ...current, stage: 'error', message: failure(error) }));
    } finally {
      active.current = false;
    }
  }, [canCancelP2, runtime, sharedWalletSession?.actions, state.pending]);

  const review = useCallback(async () => {
    if (state.pending) {
      if (ownerActionAvailable) await process();
      return;
    }
    const actions = sharedWalletSession?.actions;
    if (!actions || runtime.status !== 'ready' || !quote.plan || active.current) return;
    const wallet = sharedWalletSession?.walletAddress.trim() ?? '';
    if (!wallet) {
      await actions.connectBrowserWallet(undefined, { preparePrivacy: true });
      return;
    }
    if (sharedWalletSession?.chainId !== Number(runtime.manifest.chainId)) {
      await actions.runWalletTransactionFlow(() => actions.getSigner(false));
      return;
    }
    const formatQuoteAmount = (lots: bigint, output = false) => quote.lane === 'p2'
      ? formatSuccessorP2PlanAmount(quote.plan, lots, output)
      : formatSuccessorSwapPlanAmount(quote.plan, lots, output);
    const accepted = await requestConfirmation(Object.freeze({
      title: 'Review private Swap',
      message: 'You sign the Swap submission once. A permissionless keeper processes the fixed, privacy-padded work schedule in the background.',
      primaryLabel: 'Submit private Swap',
      fundingMoves: [],
      summaryRows: [
        { label: 'Maximum spend', value: `${formatQuoteAmount(quote.plan.maximumInputLots)} ${quote.plan.inputSymbol}` },
        { label: 'Minimum receive', value: quote.plan.minimumOutputLots === 0n ? 'Any protected output' : `${formatQuoteAmount(quote.plan.minimumOutputLots, true)} ${quote.plan.outputSymbol}` },
        { label: 'Pair', value: quote.plan.pair.displayPair },
        { label: 'Work schedule', value: quote.lane === 'p2'
          ? 'Atomic P2 opening, padded direct/one-intermediate work, settlement, and final fold'
          : `${23 * quote.plan.pair.sourceCount + 2} padded frames, settlement, then ${quote.plan.pair.sourceCount} source cleanup ${quote.plan.pair.sourceCount === 1 ? 'frame' : 'frames'}` }
      ],
      stats: [
        { label: 'Amounts', value: 'Private' },
        { label: quote.lane === 'p2' ? 'Routes' : 'Sources', value: quote.lane === 'p2' ? '2 padded' : String(quote.plan.pair.sourceCount) },
        { label: 'Settlement', value: 'Asynchronous' }
      ]
    }));
    if (!accepted) return;
    active.current = true;
    setState(Object.freeze({ stage: 'busy', message: 'Preparing the private allowance and Swap inputs…', transactionHash: '', pending: null }));
    try {
      await actions.runWalletTransactionFlow(async () => {
        const signer = await actions.getSigner(true);
        if (quote.lane === 'p2') {
          const submission = await submitSuccessorP2Intent({ signer, manifest: runtime.manifest, plan: quote.plan });
          setState(Object.freeze({
            stage: 'working',
            message: `P2 intent #${submission.intentId} is open. A permissionless keeper is processing its padded route work.`,
            transactionHash: submission.transactionHash,
            pending: Object.freeze({
              kind: 'p2',
              intentId: submission.intentId,
              expiry: submission.expiry,
              plan: quote.plan,
              status: submission.status,
              maximumKnown: true
            })
          }));
          return;
        }
        const submission = await submitSuccessorSwap({ signer, manifest: runtime.manifest, plan: quote.plan! });
        const progress = await readSuccessorSwapProgress({
          signer,
          manifest: runtime.manifest,
          pair: quote.plan!.pair,
          requestId: submission.requestId
        });
        setState(Object.freeze({
          stage: 'working',
          message: `Swap request #${submission.requestId} is open. A permissionless keeper is processing its fixed, privacy-padded work schedule.`,
          transactionHash: submission.transactionHash,
          pending: Object.freeze({ kind: 'direct', requestId: submission.requestId, deadline: submission.deadline, plan: quote.plan, progress, maximumKnown: true })
        }));
      });
    } catch (error) {
      setState(Object.freeze({ stage: 'error', message: failure(error), transactionHash: '', pending: null }));
    } finally {
      active.current = false;
    }
  }, [ownerActionAvailable, process, quote, requestConfirmation, runtime, sharedWalletSession, state.pending]);

  const wallet = sharedWalletSession?.walletAddress.trim() ?? '';
  const onChain = runtime.status === 'ready' && sharedWalletSession?.chainId === Number(runtime.manifest.chainId);
  const busy = state.stage === 'busy';
  const buttonLabel = runtime.status !== 'ready'
    ? runtime.status === 'loading' ? 'Verifying successor DEX' : 'Successor DEX unavailable'
    : !sharedWalletSession?.actions
      ? 'Wallet unavailable'
      : !wallet
        ? 'Connect wallet'
        : !onChain
          ? 'Switch to COTI Testnet'
          : busy
            ? state.message
            : state.pending
              ? canReveal
                ? 'Reveal private receipt'
                : p2FallbackAvailable
                  ? 'Open P2 fallback - separate signature'
                : tokenCredit
                ? `Withdraw ${tokenCredit.symbol} Swap credit`
                : pendingAction === 'withdraw-credit' || p2WorkCreditAvailable
                    ? 'Withdraw work credit'
                    : pendingAction === 'reopen'
                      ? 'Retry P2 route search'
                      : pendingAction === 'recover-work'
                        ? 'Recover expired P2 work'
                        : pendingAction === 'recover-intent'
                          ? 'Recover expired P2 input'
                    : pendingAction === 'complete'
                      ? 'Swap complete'
                      : pendingAction === 'recover'
                        ? 'Waiting for recovery keeper'
                        : state.pending.settled
                          ? 'Keeper finalizing Swap'
                          : state.pending.recovered
                            ? 'Keeper finalizing recovery'
                            : state.pending.kind === 'p2'
                              ? `Waiting for keeper · P2 stage ${state.pending.status.workStage}`
                              : `Waiting for keeper · ${state.pending.progress.workCursor}/${state.pending.progress.settlementCursor}`
              : quote.error
                ? 'Check Swap details'
                : 'Review private Swap';
  return Object.freeze({
    plan: quote.plan,
    quoteError: quote.error,
    stage: state.stage,
    message: state.message,
    transactionHash: state.transactionHash,
    receiptStatus: state.stage === 'success' || state.stage === 'no-match'
      ? 'Private receipt available'
      : state.stage === 'recovered'
        ? 'Input recovered'
      : state.pending ? `${state.pending.kind === 'p2' ? 'P2 intent' : 'Request'} #${state.pending.kind === 'p2' ? state.pending.intentId : state.pending.requestId}` : 'Not submitted',
    busy,
    buttonLabel,
    canReview: runtime.status === 'ready' && Boolean(sharedWalletSession?.actions) && !busy && (
      !wallet || !onChain || (state.pending ? ownerActionAvailable : Boolean(quote.plan))
    ),
    review,
    canCancelP2,
    cancelP2
  });
}
