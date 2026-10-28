import { useCallback, useRef, useState } from 'react';
import {
  confirmPrivateLiquidityPositionAction,
  ensurePrivateLiquidityInputAllowance,
  submitPrivateLiquidityPositionAction,
  type ConfirmedPrivateLiquidityPositionAction
} from '../../../lib/privateLiquidityActions';
import type { AttestedPrivateLiquidityDeployment } from '../../../lib/privateLiquidityChain';
import {
  preparePrivateLiquidityPositionAction,
  type PrivateLiquidityPositionActionIntent
} from '../../../lib/privateLiquidityPositionFlow';
import type { TradeActionConfirmModel } from '../../../lib/tradeActionConfirm';
import type { WalletSessionActions } from '../../../lib/walletSession';
import { getProviderErrorMessage } from '../../../lib/appShared/core';

export type PrivateLiquidityPositionActionStage =
  | 'idle'
  | 'reviewing'
  | 'unlocking-privacy'
  | 'setting-up-token'
  | 'refreshing-allowance'
  | 'approving-token'
  | 'signing-position'
  | 'confirming-position'
  | 'success'
  | 'error';

type ActionState = Readonly<{
  action: PrivateLiquidityPositionActionIntent['kind'] | null;
  stage: PrivateLiquidityPositionActionStage;
  message: string;
  confirmed?: ConfirmedPrivateLiquidityPositionAction;
}>;

const IDLE_STATE: ActionState = Object.freeze({ action: null, stage: 'idle', message: '' });

const INVALID_AMOUNT_SELECTOR = '0x2c5211c6';

const failureMessage = (error: unknown, context: string): string => {
  const providerMessage = getProviderErrorMessage(error, 'Private-liquidity position action failed.');
  const explanation = providerMessage.toLowerCase().includes(INVALID_AMOUNT_SELECTOR)
    ? 'COTI rejected the encrypted amount as invalid (InvalidAmount).'
    : providerMessage;
  return `${context} failed: ${explanation}`;
};

const activeStage = (stage: PrivateLiquidityPositionActionStage): boolean => [
  'reviewing',
  'unlocking-privacy',
  'setting-up-token',
  'refreshing-allowance',
  'approving-token',
  'signing-position',
  'confirming-position'
].includes(stage);

export default function usePrivateLiquidityPositionAction({
  deployment,
  walletReady,
  walletActions,
  requestConfirmation,
  refresh,
  onCreated
}: {
  deployment: AttestedPrivateLiquidityDeployment | null;
  walletReady: boolean;
  walletActions?: Pick<WalletSessionActions, 'getPrivateLiquidityCapability' | 'runWalletTransactionFlow'>;
  requestConfirmation: (confirmation: TradeActionConfirmModel) => Promise<boolean>;
  refresh: () => void;
  onCreated: (positionId: string) => void;
}) {
  const activeActionRef = useRef(false);
  const [state, setState] = useState<ActionState>(IDLE_STATE);

  const execute = useCallback(async (intent: PrivateLiquidityPositionActionIntent) => {
    const getCapability = walletActions?.getPrivateLiquidityCapability;
    const runWalletTransactionFlow = walletActions?.runWalletTransactionFlow;
    if (!deployment || !walletReady || !getCapability || !runWalletTransactionFlow || activeActionRef.current) return;

    let prepared;
    try {
      prepared = preparePrivateLiquidityPositionAction(intent);
    } catch (error) {
      setState(Object.freeze({
        action: intent.kind,
        stage: 'error',
        message: failureMessage(error, 'Position form validation')
      }));
      return;
    }

    activeActionRef.current = true;
    let failureContext = 'Wallet and privacy preparation';
    setState(Object.freeze({
      action: intent.kind,
      stage: 'reviewing',
      message: 'Review the Position NFT action before opening your wallet.'
    }));
    try {
      if (!await requestConfirmation(prepared.confirmation)) {
        setState(IDLE_STATE);
        return;
      }
      setState(Object.freeze({
        action: intent.kind,
        stage: 'unlocking-privacy',
        message: prepared.requiresPrivacy
          ? 'Unlocking COTI privacy for this Position NFT action…'
          : 'Verifying the selected browser-wallet owner…'
      }));
      const confirmed = await runWalletTransactionFlow(async () => {
        const capability = await getCapability(prepared.requiresPrivacy, BigInt(deployment.chainId));
        for (const requirement of prepared.requiredApprovals) {
          failureContext = `${requirement.token.symbol} allowance check`;
          await ensurePrivateLiquidityInputAllowance({
            capability,
            deployment,
            tokenAddress: requirement.token.address,
            requiredAmount: requirement.amount,
            approvalPolicy: requirement.policy,
            onStage: (stage) => {
              failureContext = stage === 'setting-up-token'
                ? `${requirement.token.symbol} privacy setup`
                : stage === 'refreshing-allowance'
                  ? `${requirement.token.symbol} allowance refresh`
                  : `${requirement.token.symbol} encrypted approval`;
              setState(Object.freeze({
                action: intent.kind,
                stage,
                message: stage === 'setting-up-token'
                  ? `Setting up ${requirement.token.symbol} privacy for this MetaMask account…`
                  : stage === 'refreshing-allowance'
                    ? `Refreshing the private ${requirement.token.symbol} allowance for this privacy key…`
                    : `Confirming the one-time ${requirement.token.symbol} approval…`
              }));
            }
          });
        }
        failureContext = `Position NFT ${intent.kind} submission`;
        setState(Object.freeze({
          action: intent.kind,
          stage: 'signing-position',
          message: 'Confirm the Position NFT transaction in your wallet…'
        }));
        const submission = await submitPrivateLiquidityPositionAction({
          capability,
          deployment,
          action: prepared.action
        });
        setState(Object.freeze({
          action: intent.kind,
          stage: 'confirming-position',
          message: 'Waiting for the canonical Position NFT receipt…'
        }));
        failureContext = `Position NFT ${intent.kind} receipt confirmation`;
        return confirmPrivateLiquidityPositionAction({ capability, deployment, submission });
      });
      setState(Object.freeze({
        action: intent.kind,
        stage: 'success',
        message: intent.kind === 'create'
          ? `Position NFT #${confirmed.positionId} created.`
          : `Position NFT #${confirmed.positionId} ${intent.kind.replace(/-/g, ' ')} confirmed.`,
        confirmed
      }));
      refresh();
      if (intent.kind === 'create') onCreated(confirmed.positionId);
    } catch (error) {
      setState(Object.freeze({
        action: intent.kind,
        stage: 'error',
        message: failureMessage(error, failureContext)
      }));
    } finally {
      activeActionRef.current = false;
    }
  }, [deployment, onCreated, refresh, requestConfirmation, walletActions, walletReady]);

  return Object.freeze({
    busy: activeStage(state.stage),
    confirmed: state.confirmed ?? null,
    currentAction: state.action,
    execute,
    message: state.message,
    stage: state.stage
  });
}
