import { useCallback, useRef, useState } from 'react';
import {
  confirmPrivateLiquidityHiddenIntentSettlement,
  confirmPrivateLiquidityHiddenIntentAction,
  ensurePrivateLiquidityInputAllowance,
  readPrivateLiquidityHiddenIntentPairStatus,
  submitPrivateLiquidityHiddenIntentSettlement,
  submitPrivateLiquidityHiddenIntentAction,
  type ConfirmedPrivateLiquidityHiddenIntentSettlement,
  type ConfirmedPrivateLiquidityHiddenIntentAction
} from '../../../lib/privateLiquidityActions';
import type {
  AttestedPrivateLiquidityDeployment,
  CompleteCanonicalPrivateLiquidityPositionSnapshot
} from '../../../lib/privateLiquidityChain';
import { buildPrivateLiquidityHiddenIntentSettlementRoutes } from '../../../lib/privateLiquidityHiddenIntents';
import {
  preparePrivateLiquidityHiddenIntentFlow,
  type PrivateLiquidityHiddenIntentDraft
} from '../../../lib/privateLiquidityHiddenIntentFlow';
import type { TradeActionConfirmModel } from '../../../lib/tradeActionConfirm';
import type { WalletSessionActions } from '../../../lib/walletSession';
import { getProviderErrorMessage } from '../../../lib/appShared/core';

type HiddenIntentStage =
  | 'idle'
  | 'reviewing'
  | 'unlocking-privacy'
  | 'setting-up-token'
  | 'refreshing-allowance'
  | 'approving-token'
  | 'signing-intent'
  | 'confirming-intent'
  | 'success'
  | 'error';

type State = Readonly<{
  stage: HiddenIntentStage;
  message: string;
  confirmed?: ConfirmedPrivateLiquidityHiddenIntentAction | ConfirmedPrivateLiquidityHiddenIntentSettlement;
}>;

const IDLE: State = Object.freeze({ stage: 'idle', message: '' });
const busyStage = (stage: HiddenIntentStage): boolean => [
  'reviewing',
  'unlocking-privacy',
  'setting-up-token',
  'refreshing-allowance',
  'approving-token',
  'signing-intent',
  'confirming-intent'
].includes(stage);

export default function usePrivateLiquidityHiddenIntentAction({
  deployment,
  completeSnapshot,
  walletReady,
  walletActions,
  requestConfirmation,
  refresh
}: {
  deployment: AttestedPrivateLiquidityDeployment | null;
  completeSnapshot?: CompleteCanonicalPrivateLiquidityPositionSnapshot | null;
  walletReady: boolean;
  walletActions?: Pick<WalletSessionActions, 'getPrivateLiquidityCapability' | 'runWalletTransactionFlow'>;
  requestConfirmation: (confirmation: TradeActionConfirmModel) => Promise<boolean>;
  refresh: () => void;
}) {
  const activeRef = useRef(false);
  const [state, setState] = useState<State>(IDLE);
  const create = useCallback(async (draft: PrivateLiquidityHiddenIntentDraft) => {
    const getCapability = walletActions?.getPrivateLiquidityCapability;
    const runWalletTransactionFlow = walletActions?.runWalletTransactionFlow;
    if (!deployment || !walletReady || !getCapability || !runWalletTransactionFlow || activeRef.current) return;
    let prepared;
    try {
      prepared = preparePrivateLiquidityHiddenIntentFlow(draft);
    } catch (error) {
      setState(Object.freeze({
        stage: 'error',
        message: getProviderErrorMessage(error, 'Hidden-intent inputs are invalid.')
      }));
      return;
    }
    activeRef.current = true;
    setState(Object.freeze({ stage: 'reviewing', message: 'Review the private recurring intent.' }));
    try {
      if (!await requestConfirmation(prepared.confirmation)) {
        setState(IDLE);
        return;
      }
      setState(Object.freeze({
        stage: 'unlocking-privacy',
        message: 'Unlocking COTI privacy for two packed hidden-intent inputsâ€¦'
      }));
      const confirmed = await runWalletTransactionFlow(async () => {
        const capability = await getCapability(true, BigInt(deployment.chainId));
        await ensurePrivateLiquidityInputAllowance({
          capability,
          deployment,
          tokenAddress: prepared.inputToken.address,
          requiredAmount: prepared.maximumBudget,
          onStage: (stage) => setState(Object.freeze({
            stage,
            message: stage === 'setting-up-token'
              ? `Setting up ${prepared.inputToken.symbol} privacy for this MetaMask accountâ€¦`
              : stage === 'refreshing-allowance'
                ? `Refreshing the private ${prepared.inputToken.symbol} allowance for this privacy keyâ€¦`
                : `Confirming the one-time ${prepared.inputToken.symbol} approvalâ€¦`
          }))
        });
        setState(Object.freeze({
          stage: 'signing-intent',
          message: 'Confirm the hidden-intent transaction in your wallet…'
        }));
        const submission = await submitPrivateLiquidityHiddenIntentAction({
          capability,
          deployment,
          action: { kind: 'create-hidden-intent', prepared: prepared.prepared }
        });
        setState(Object.freeze({
          stage: 'confirming-intent',
          message: 'Waiting for the canonical hidden-intent receiptâ€¦'
        }));
        return confirmPrivateLiquidityHiddenIntentAction({ capability, deployment, submission });
      });
      setState(Object.freeze({
        stage: 'success',
        message: `Hidden recurring intent #${confirmed.intentId} created.`,
        confirmed
      }));
      refresh();
    } catch (error) {
      setState(Object.freeze({
        stage: 'error',
        message: getProviderErrorMessage(error, 'Hidden-intent creation failed.')
      }));
    } finally {
      activeRef.current = false;
    }
  }, [deployment, refresh, requestConfirmation, walletActions, walletReady]);

  const update = useCallback(async (
    kind: 'cancel-hidden-intent' | 'reclaim-expired-hidden-intent',
    intentId: string
  ) => {
    const getCapability = walletActions?.getPrivateLiquidityCapability;
    const runWalletTransactionFlow = walletActions?.runWalletTransactionFlow;
    if (!deployment || !walletReady || !getCapability || !runWalletTransactionFlow || activeRef.current) return;
    activeRef.current = true;
    setState(Object.freeze({
      stage: 'reviewing',
      message: kind === 'cancel-hidden-intent'
        ? `Review cancellation of hidden intent #${intentId}.`
        : `Review expiry reclaim for hidden intent #${intentId}.`
    }));
    try {
      const actionLabel = kind === 'cancel-hidden-intent' ? 'Cancel hidden intent' : 'Reclaim expired intent';
      if (!await requestConfirmation(Object.freeze({
        title: actionLabel,
        message: kind === 'cancel-hidden-intent'
          ? 'The remaining private budget will be refunded and this recurring intent cannot execute again.'
          : 'This permissionless action marks the expired intent and refunds its remaining private budget to its owner.',
        primaryLabel: actionLabel,
        summaryRows: [{ label: 'Hidden intent', value: `#${intentId}` }],
        fundingMoves: [],
        stats: [
          { label: 'COTI private inputs', value: '0' },
          { label: 'Wallet transactions', value: '1' }
        ]
      }))) {
        setState(IDLE);
        return;
      }
      setState(Object.freeze({ stage: 'signing-intent', message: `Confirm ${actionLabel.toLowerCase()} in your wallet…` }));
      const confirmed = await runWalletTransactionFlow(async () => {
        const capability = await getCapability(false, BigInt(deployment.chainId));
        const submission = await submitPrivateLiquidityHiddenIntentAction({
          capability,
          deployment,
          action: { kind, intentId }
        });
        setState(Object.freeze({ stage: 'confirming-intent', message: 'Waiting for the canonical hidden-intent receipt…' }));
        return confirmPrivateLiquidityHiddenIntentAction({ capability, deployment, submission });
      });
      setState(Object.freeze({
        stage: 'success',
        message: kind === 'cancel-hidden-intent'
          ? `Hidden intent #${confirmed.intentId} cancelled and remaining budget refunded.`
          : `Hidden intent #${confirmed.intentId} expired budget reclaimed.`,
        confirmed
      }));
      refresh();
    } catch (error) {
      setState(Object.freeze({
        stage: 'error',
        message: getProviderErrorMessage(error, 'Hidden-intent update failed.')
      }));
    } finally {
      activeRef.current = false;
    }
  }, [deployment, refresh, requestConfirmation, walletActions, walletReady]);

  const settle = useCallback(async (pairKey: string) => {
    const getCapability = walletActions?.getPrivateLiquidityCapability;
    const runWalletTransactionFlow = walletActions?.runWalletTransactionFlow;
    if (
      !deployment ||
      !completeSnapshot ||
      !walletReady ||
      !getCapability ||
      !runWalletTransactionFlow ||
      activeRef.current
    ) return;
    activeRef.current = true;
    setState(Object.freeze({ stage: 'reviewing', message: 'Verifying the complete pair routes and open intent queue…' }));
    try {
      const pairPosition = completeSnapshot.positions.find(
        (position) => position.pairKey.toLowerCase() === pairKey.toLowerCase()
      );
      if (!pairPosition) throw new Error('The selected hidden-intent pair is not in the complete finalized position set.');
      const routes = buildPrivateLiquidityHiddenIntentSettlementRoutes({
        snapshot: completeSnapshot,
        baseToken: pairPosition.baseToken,
        quoteToken: pairPosition.quoteToken
      });
      if (routes.pairKey.toLowerCase() !== pairKey.toLowerCase()) {
        throw new Error('The selected hidden-intent pair does not match its canonical settlement routes.');
      }
      const capability = await getCapability(false, BigInt(deployment.chainId));
      const pairStatus = await readPrivateLiquidityHiddenIntentPairStatus({
        capability,
        deployment,
        pairKey: routes.pairKey,
        atBlock: completeSnapshot.atBlock
      });
      if (pairStatus.openIntentCount === '0') {
        setState(Object.freeze({
          stage: 'success',
          message: 'No open hidden intents are queued for this pair at the finalized block.'
        }));
        return;
      }
      if (!await requestConfirmation(Object.freeze({
        title: 'Settle ready hidden intents',
        message: 'The contract, not this caller, selects up to four queued intents. Both complete public price routes are submitted, so no private side, limit, or intent ID is exposed in the request.',
        primaryLabel: 'Settle next queue entries',
        summaryRows: [
          { label: 'Open queue', value: pairStatus.openIntentCount },
          { label: 'Active positions', value: String(routes.activePositionCount) },
          { label: 'Finalized block', value: routes.atBlock.number }
        ],
        fundingMoves: [],
        stats: [
          { label: 'COTI private inputs', value: '0' },
          { label: 'Wallet transactions', value: '1' },
          { label: 'Max intents processed', value: '4' }
        ]
      }))) {
        setState(IDLE);
        return;
      }
      setState(Object.freeze({
        stage: 'signing-intent',
        message: 'Confirm the bounded pair settlement in your wallet…'
      }));
      const confirmed = await runWalletTransactionFlow(async () => {
        const submission = await submitPrivateLiquidityHiddenIntentSettlement({
          capability,
          deployment,
          routes,
          deadline: BigInt(Math.floor(Date.now() / 1_000) + 300)
        });
        setState(Object.freeze({
          stage: 'confirming-intent',
          message: 'Waiting for the canonical pair-settlement receipt…'
        }));
        return confirmPrivateLiquidityHiddenIntentSettlement({ capability, deployment, submission });
      });
      setState(Object.freeze({
        stage: 'success',
        message: `Settlement #${confirmed.settlementId} processed ${confirmed.processedIntentCount} queued intent${confirmed.processedIntentCount === 1 ? '' : 's'} across ${confirmed.candidateCount} active position${confirmed.candidateCount === 1 ? '' : 's'}.`,
        confirmed
      }));
      refresh();
    } catch (error) {
      setState(Object.freeze({
        stage: 'error',
        message: getProviderErrorMessage(error, 'Hidden-intent pair settlement failed.')
      }));
    } finally {
      activeRef.current = false;
    }
  }, [completeSnapshot, deployment, refresh, requestConfirmation, walletActions, walletReady]);

  return Object.freeze({
    busy: busyStage(state.stage),
    confirmed: state.confirmed ?? null,
    cancel: (intentId: string) => update('cancel-hidden-intent', intentId),
    create,
    message: state.message,
    reclaim: (intentId: string) => update('reclaim-expired-hidden-intent', intentId),
    settle,
    stage: state.stage
  });
}
