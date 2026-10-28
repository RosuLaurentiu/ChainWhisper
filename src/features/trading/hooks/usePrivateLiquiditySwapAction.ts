import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatTokenAmount, getProviderErrorMessage } from '../../../lib/appShared/core';
import type { ResolvedTradeToken } from '../../../lib/appHelpers';
import {
  confirmPrivateLiquiditySwap,
  ensurePrivateLiquidityInputAllowance,
  isPrivateLiquidityAllowancePrivacyRefreshRequired,
  isPrivateLiquidityReceiptPrivacyRefreshRequired,
  submitPrivateLiquiditySwap,
  type ConfirmedPrivateLiquiditySwap,
  type PrivateLiquiditySwapSubmission
} from '../../../lib/privateLiquidityActions';
import type { AttestedPrivateLiquidityDeployment } from '../../../lib/privateLiquidityChain';
import {
  buildPrivateLiquiditySwapConfirmation,
  preparePrivateLiquiditySwap,
  type PreparedPrivateLiquiditySwap
} from '../../../lib/privateLiquiditySwapFlow';
import type { PrivateLiquidityWorkspaceModel } from '../../../lib/privateLiquidityWorkspaceModel';
import type { TradeActionConfirmModel } from '../../../lib/tradeActionConfirm';
import type { WalletSessionActions } from '../../../lib/walletSession';

export type PrivateLiquiditySwapActionStage =
  | 'idle'
  | 'unlocking-privacy'
  | 'setting-up-token'
  | 'refreshing-allowance'
  | 'approving-token'
  | 'signing-swap'
  | 'confirming-swap'
  | 'success'
  | 'error';

type ActionState = Readonly<{
  scopeKey: string;
  stage: PrivateLiquiditySwapActionStage;
  message: string;
  confirmed?: ConfirmedPrivateLiquiditySwap;
  requiresFreshLiquidity?: boolean;
}>;

export type FailedPrivateLiquiditySwapAttempt = Readonly<{
  key: string;
  transactionHash: string;
  direction: PreparedPrivateLiquiditySwap['quote']['direction'];
  pairKey: string;
  inputTokenSymbol: string;
  outputTokenSymbol: string;
  maximumInput: string;
  inputTokenDecimals: number;
  message: string;
  attemptedAt: number;
}>;

const IDLE_STATE: ActionState = Object.freeze({ scopeKey: '', stage: 'idle', message: '' });

const preparedScopeKey = (
  prepared: PreparedPrivateLiquiditySwap | null,
  model: PrivateLiquidityWorkspaceModel | null
): string => prepared && model
  ? [
      prepared.plan.chainId,
      prepared.plan.contractAddress,
      model.atBlock.number,
      model.atBlock.hash,
      prepared.quote.pairKey,
      prepared.quote.direction,
      prepared.quote.maximumInput,
      prepared.quote.minimumInputFilled,
      prepared.quote.slippageBps,
      ...prepared.quote.candidates.flatMap(({ positionId, expectedRevision }) => [positionId, expectedRevision])
    ].join(':')
  : '';

const failureMessage = (error: unknown): string =>
  (() => {
    const message = getProviderErrorMessage(error, 'Private-liquidity swap failed.');
    return message === 'Private-liquidity swap transaction did not succeed.'
      ? 'The private swap could not meet its execution conditions. Private depth may be insufficient, or the selected position changed. Refresh finalized liquidity, reduce the minimum fill, or try the opposite direction.'
      : message;
  })();

const isFailedSwapReceipt = (error: unknown): boolean =>
  getProviderErrorMessage(error, '') === 'Private-liquidity swap transaction did not succeed.';

export default function usePrivateLiquiditySwapAction({
  active,
  deployment,
  model,
  sellToken,
  buyToken,
  sellAmountInput,
  slippageBps,
  minimumFillBps,
  walletReady,
  walletActions,
  requestConfirmation,
  refresh
}: {
  active: boolean;
  deployment: AttestedPrivateLiquidityDeployment | null;
  model: PrivateLiquidityWorkspaceModel | null;
  sellToken: ResolvedTradeToken | null;
  buyToken: ResolvedTradeToken | null;
  sellAmountInput: string;
  slippageBps: number;
  minimumFillBps: number;
  walletReady: boolean;
  walletActions?: Pick<WalletSessionActions, 'getPrivateLiquidityCapability' | 'runWalletTransactionFlow'>;
  requestConfirmation: (confirmation: TradeActionConfirmModel) => Promise<boolean>;
  refresh: () => void;
}) {
  const preparedResult = useMemo(() => {
    if (!active || !deployment || !model) {
      return Object.freeze({ prepared: null, error: '' });
    }
    try {
      return Object.freeze({
        prepared: preparePrivateLiquiditySwap({
          chainId: deployment.chainId,
          contractAddress: deployment.contractAddress,
          model,
          sellToken,
          buyToken,
          sellAmountInput,
          slippageBps,
          minimumFillBps
        }),
        error: ''
      });
    } catch (error) {
      return Object.freeze({ prepared: null, error: failureMessage(error) });
    }
  }, [
    active,
    buyToken,
    deployment,
    minimumFillBps,
    model,
    sellAmountInput,
    sellToken,
    slippageBps
  ]);
  const scopeKey = preparedScopeKey(preparedResult.prepared, model);
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;
  const activeActionRef = useRef(false);
  const finalizedRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<ActionState>(IDLE_STATE);
  const [failedAttempts, setFailedAttempts] = useState<readonly FailedPrivateLiquiditySwapAttempt[]>([]);
  const visibleState = state.scopeKey === scopeKey ? state : IDLE_STATE;
  const quoteRequiresFreshLiquidity = Boolean(
    visibleState.requiresFreshLiquidity && visibleState.stage === 'error'
  );

  const refreshThroughFinality = useCallback(() => {
    refresh();
    if (finalizedRefreshTimerRef.current) clearTimeout(finalizedRefreshTimerRef.current);
    finalizedRefreshTimerRef.current = setTimeout(refresh, 30_000);
  }, [refresh]);

  useEffect(() => () => {
    if (finalizedRefreshTimerRef.current) clearTimeout(finalizedRefreshTimerRef.current);
  }, []);

  const review = useCallback(async () => {
    const prepared = preparedResult.prepared;
    const getCapability = walletActions?.getPrivateLiquidityCapability;
    const runWalletTransactionFlow = walletActions?.runWalletTransactionFlow;
    if (!prepared || !deployment || !walletReady || !getCapability || !runWalletTransactionFlow) return;
    if (activeActionRef.current) return;
    const capturedScopeKey = scopeKey;
    const confirmedByUser = await requestConfirmation(buildPrivateLiquiditySwapConfirmation(prepared));
    if (!confirmedByUser || scopeKeyRef.current !== capturedScopeKey) return;
    activeActionRef.current = true;
    const submittedRef: { current: PrivateLiquiditySwapSubmission | null } = { current: null };
    setState(Object.freeze({
      scopeKey: capturedScopeKey,
      stage: 'unlocking-privacy',
      message: 'Unlocking private-token permissions…'
    }));
    try {
      const confirmed = await runWalletTransactionFlow(async () => {
        let capability = await getCapability(true, BigInt(deployment.chainId));
        if (scopeKeyRef.current !== capturedScopeKey) {
          throw new Error('Private-liquidity quote changed before signing. Review it again.');
        }
        const ensureAllowance = () => ensurePrivateLiquidityInputAllowance({
          capability,
          deployment,
          tokenAddress: prepared.inputToken.tokenAddress,
          requiredAmount: prepared.quote.maximumInput,
          onStage: (stage) => setState(Object.freeze({
            scopeKey: capturedScopeKey,
            stage,
            message: stage === 'setting-up-token'
              ? 'Setting up this private token for your wallet account…'
              : stage === 'refreshing-allowance'
                ? 'Refreshing this private-token allowance for the current privacy key…'
                : 'Confirming the one-time private-token approval…'
          }))
        });
        try {
          await ensureAllowance();
        } catch (error) {
          if (!isPrivateLiquidityAllowancePrivacyRefreshRequired(error)) throw error;
          setState(Object.freeze({
            scopeKey: capturedScopeKey,
            stage: 'unlocking-privacy',
            message: 'Refreshing the wallet privacy key for this allowance…'
          }));
          capability = await getCapability(true, BigInt(deployment.chainId), { refreshAes: true });
          if (scopeKeyRef.current !== capturedScopeKey) {
            throw new Error('Private-liquidity quote changed while refreshing privacy. Review it again.');
          }
          await ensureAllowance();
        }
        if (scopeKeyRef.current !== capturedScopeKey) {
          throw new Error('Private-liquidity quote changed before signing. Review it again.');
        }
        setState(Object.freeze({
          scopeKey: capturedScopeKey,
          stage: 'signing-swap',
          message: 'Confirm the private swap in your wallet…'
        }));
        const submission = await submitPrivateLiquiditySwap({
          capability,
          deployment,
          plan: prepared.plan,
          inputAmount: prepared.quote.maximumInput,
          slippageBps: prepared.quote.slippageBps,
          minimumFillBps: prepared.quote.minimumFillBps,
          deadline: BigInt(Math.floor(Date.now() / 1_000) + 30 * 60)
        });
        submittedRef.current = submission;
        setState(Object.freeze({
          scopeKey: capturedScopeKey,
          stage: 'confirming-swap',
          message: 'Waiting for the private swap receipt…'
        }));
        try {
          return await confirmPrivateLiquiditySwap({ capability, deployment, submission });
        } catch (error) {
          if (!isPrivateLiquidityReceiptPrivacyRefreshRequired(error)) throw error;
          setState(Object.freeze({
            scopeKey: capturedScopeKey,
            stage: 'unlocking-privacy',
            message: 'Refreshing privacy to verify the completed swap receipt…'
          }));
          capability = await getCapability(true, BigInt(deployment.chainId), { refreshAes: true });
          if (scopeKeyRef.current !== capturedScopeKey) {
            throw new Error('Private-liquidity quote changed while verifying the completed receipt.');
          }
          setState(Object.freeze({
            scopeKey: capturedScopeKey,
            stage: 'confirming-swap',
            message: 'Verifying the completed private swap receipt…'
          }));
          return confirmPrivateLiquiditySwap({ capability, deployment, submission });
        }
      });
      if (scopeKeyRef.current !== capturedScopeKey) return;
      const input = formatTokenAmount(
        BigInt(confirmed.inputAmount),
        prepared.inputToken.decimals,
        6
      );
      const output = formatTokenAmount(
        BigInt(confirmed.outputAmount),
        prepared.outputToken.decimals,
        6
      );
      setState(Object.freeze({
        scopeKey: capturedScopeKey,
        stage: 'success',
        message: `Swapped ${input} ${prepared.inputToken.symbol} for ${output} ${prepared.outputToken.symbol}.`,
        confirmed
      }));
      refreshThroughFinality();
    } catch (error) {
      const requiresFreshLiquidity = isFailedSwapReceipt(error);
      const submitted = submittedRef.current;
      if (submitted && requiresFreshLiquidity) {
        const failed = Object.freeze({
          key: `failed-private-liquidity-swap:${submitted.submittedTransactionHash}`,
          transactionHash: submitted.submittedTransactionHash,
          direction: prepared.quote.direction,
          pairKey: prepared.quote.pairKey,
          inputTokenSymbol: prepared.inputToken.symbol,
          outputTokenSymbol: prepared.outputToken.symbol,
          maximumInput: prepared.quote.maximumInput,
          inputTokenDecimals: prepared.inputToken.decimals,
          message: failureMessage(error),
          attemptedAt: Date.now()
        });
        setFailedAttempts((current) => Object.freeze([
          failed,
          ...current.filter(({ transactionHash }) => transactionHash !== failed.transactionHash)
        ].slice(0, 10)));
      }
      if (scopeKeyRef.current === capturedScopeKey) {
        setState(Object.freeze({
          scopeKey: capturedScopeKey,
          stage: 'error',
          message: failureMessage(error),
          requiresFreshLiquidity
        }));
      }
      if (requiresFreshLiquidity) refreshThroughFinality();
    } finally {
      activeActionRef.current = false;
    }
  }, [
    deployment,
    preparedResult.prepared,
    refreshThroughFinality,
    requestConfirmation,
    scopeKey,
    walletActions,
    walletReady
  ]);

  return Object.freeze({
    quote: quoteRequiresFreshLiquidity ? null : preparedResult.prepared?.quote ?? null,
    quoteError: quoteRequiresFreshLiquidity
      ? 'Waiting for a newer finalized liquidity snapshot before another attempt.'
      : preparedResult.error,
    stage: visibleState.stage,
    message: visibleState.message,
    confirmed: state.confirmed ?? null,
    failedAttempts,
    busy: [
      'unlocking-privacy',
      'setting-up-token',
      'refreshing-allowance',
      'approving-token',
      'signing-swap',
      'confirming-swap'
    ].includes(visibleState.stage),
    review
  });
}
