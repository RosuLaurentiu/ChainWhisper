import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getProviderErrorMessage } from '../../../lib/appShared/core';
import {
  captureDexV2ActionIntent,
  type DexV2ActionIntent
} from '../../../lib/dexV2Actions';
import {
  ensureDexV2InputAllowance,
  isDexV2AllowancePrivacyRefreshRequired,
  type DexV2AllowanceStage
} from '../../../lib/dexV2PrivateToken';
import {
  confirmDexV2PoolPosition,
  submitDexV2PoolPosition,
  type ConfirmedDexV2PoolPosition
} from '../../../lib/dexV2PoolExecution';
import { quoteDexV2PoolDeposit } from '../../../lib/dexV2PoolTerms';
import { formatDexV2LotsAsTokenAmount } from '../../../lib/dexV2Terms';
import type { TradeActionConfirmModel } from '../../../lib/tradeActionConfirm';
import type { SharedWalletSession } from '../../../lib/walletSession';
import type { DexV2RuntimeState } from './useDexV2Runtime';

export type DexV2PoolActionStage =
  | 'idle'
  | 'connecting-wallet'
  | 'switching-network'
  | 'unlocking-privacy'
  | 'setting-up-token'
  | 'refreshing-allowance'
  | 'approving-token'
  | 'signing'
  | 'confirming'
  | 'success'
  | 'error';

type ActionState = Readonly<{
  scopeKey: string;
  stage: DexV2PoolActionStage;
  message: string;
  confirmed?: ConfirmedDexV2PoolPosition;
}>;

const IDLE: ActionState = Object.freeze({ scopeKey: '', stage: 'idle', message: '' });

const actionError = (error: unknown): string => {
  const message = getProviderErrorMessage(error, 'The private Pool position could not be created.');
  if (/cannot authenticate private inputs|InvalidInputSigner/iu.test(message)) {
    return 'This activated DEX contract does not accept this browser wallet’s private-input signature format. No Pool transaction was sent. A browser-compatible DEX deployment is required.';
  }
  if (/allowance|transfer amount exceeds|transferFrom/iu.test(message)) {
    return 'One of the Pool tokens has not approved enough private allowance for DEX Core yet.';
  }
  if (/InvalidPrivateTerms|transaction did not succeed|execution reverted/iu.test(message)) {
    return 'The Pool deposit was rejected. Refresh the finalized Pool state and review the maxima again.';
  }
  return message;
};

export default function useDexV2PoolAction({
  baseAmount,
  quoteAmount,
  requestConfirmation,
  runtime,
  sharedWalletSession,
  refresh
}: {
  baseAmount: string;
  quoteAmount: string;
  requestConfirmation: (confirmation: TradeActionConfirmModel) => Promise<boolean>;
  runtime: DexV2RuntimeState;
  sharedWalletSession?: SharedWalletSession;
  refresh: () => void;
}) {
  const quote = useMemo(() => {
    if (runtime.status !== 'ready') return Object.freeze({ error: '', value: null });
    try {
      const pair = runtime.deployment.manifest.pair;
      return Object.freeze({
        error: '',
        value: quoteDexV2PoolDeposit({
          baseAmount,
          quoteAmount,
          baseDecimals: pair.baseDecimals,
          quoteDecimals: pair.quoteDecimals,
          baseLotSize: BigInt(pair.baseLotSize),
          quoteLotSize: BigInt(pair.quoteLotSize),
          maximumAggregateLots: BigInt(pair.maximumAggregateLots),
          poolEmpty: runtime.deployment.lastPublicPoolPriorityId === '0'
        })
      });
    } catch (error) {
      return Object.freeze({ error: actionError(error), value: null });
    }
  }, [baseAmount, quoteAmount, runtime]);
  const scopeKey = runtime.status === 'ready' && quote.value
    ? [
        runtime.deployment.manifest.manifestHash,
        runtime.deployment.attestationBlock.number,
        sharedWalletSession?.walletAddress.trim().toLowerCase() ?? '',
        quote.value.baseMaximumLots,
        quote.value.quoteMaximumLots,
        runtime.deployment.lastPublicPoolPriorityId
      ].join(':')
    : '';
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const activeRef = useRef(false);
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

  const review = useCallback(async () => {
    const walletActions = sharedWalletSession?.actions;
    if (activeRef.current || runtime.status !== 'ready' || !walletActions || runtime.deployment.newActivityPaused) return;
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
    const intent: DexV2ActionIntent = captureDexV2ActionIntent({
      kind: 'create-pool',
      baseMaximumLots: quote.value.baseMaximumLots,
      quoteMaximumLots: quote.value.quoteMaximumLots
    });
    const accepted = await requestConfirmation(Object.freeze({
      title: runtime.deployment.lastPublicPoolPriorityId === '0'
        ? 'Confirm private Pool seed'
        : 'Confirm private Pool position',
      message: 'Both maximum deposits are encrypted for DEX Core. The contract transfers only the proportional amounts it uses; unused maxima stay in your wallet.',
      primaryLabel: 'Continue to wallet',
      fundingMoves: [],
      summaryRows: [
        { label: 'Maximum pUSDC', value: `${baseAmount} pUSDC` },
        { label: 'Maximum pUSDT', value: `${quoteAmount} pUSDT` },
        {
          label: 'Position',
          value: quote.value.initialSeedUnits === null
            ? 'Pro-rata share of the aggregate Pool'
            : `${quote.value.initialSeedUnits.toString()} canonical depth unit${quote.value.initialSeedUnits === 1n ? '' : 's'}`
        }
      ],
      stats: [
        { label: 'Pool bins', value: '4 aggregate bins' },
        { label: 'Allowances', value: 'Both tokens, exact maxima' },
        { label: 'Ownership', value: 'Position NFT' },
        { label: 'Finality', value: '5 confirmations' }
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
        const ensureBothAllowances = async () => {
          for (const token of [
            {
              address: runtime.deployment.manifest.pair.baseToken,
              lots: quote.value.baseMaximumLots,
              symbol: 'pUSDC'
            },
            {
              address: runtime.deployment.manifest.pair.quoteToken,
              lots: quote.value.quoteMaximumLots,
              symbol: 'pUSDT'
            }
          ] as const) {
            if (scopeRef.current !== capturedScope) {
              throw new Error('The Pool deposit changed before signing. Review it again.');
            }
            const updateAllowanceStage = (stage: DexV2AllowanceStage) => setState(Object.freeze({
              scopeKey: capturedScope,
              stage,
              message: stage === 'setting-up-token'
                ? `Setting up ${token.symbol} for this privacy account…`
                : stage === 'refreshing-allowance'
                  ? `Refreshing the ${token.symbol} allowance ciphertext…`
                  : `Confirm the ${token.symbol} allowance in your wallet…`
            }));
            await ensureDexV2InputAllowance({
              deployment: runtime.deployment,
              inputToken: token.address,
              maximumInputLots: token.lots,
              signer,
              onStage: updateAllowanceStage
            });
          }
        };
        try {
          await ensureBothAllowances();
        } catch (error) {
          if (!isDexV2AllowancePrivacyRefreshRequired(error)) throw error;
          setState(Object.freeze({
            scopeKey: capturedScope,
            stage: 'unlocking-privacy',
            message: 'Refreshing the wallet privacy key for the Pool allowances…'
          }));
          signer = await walletActions.getSigner(true, { refreshAes: true });
          await ensureBothAllowances();
        }
        if (scopeRef.current !== capturedScope) {
          throw new Error('The Pool deposit changed before signing. Review it again.');
        }
        setState(Object.freeze({
          scopeKey: capturedScope,
          stage: 'signing',
          message: 'Confirm the private Pool position in your wallet…'
        }));
        const submission = await submitDexV2PoolPosition({
          deployment: runtime.deployment,
          intent,
          signer
        });
        setState(Object.freeze({
          scopeKey: capturedScope,
          stage: 'confirming',
          message: 'Waiting for five confirmations and your private Pool claim…'
        }));
        return confirmDexV2PoolPosition({ deployment: runtime.deployment, signer, submission });
      });
      if (scopeRef.current !== capturedScope) return;
      const pair = runtime.deployment.manifest.pair;
      const baseClaim = formatDexV2LotsAsTokenAmount(
        BigInt(confirmed.baseClaimLots),
        pair.baseDecimals,
        BigInt(pair.baseLotSize)
      );
      const quoteClaim = formatDexV2LotsAsTokenAmount(
        BigInt(confirmed.quoteClaimLots),
        pair.quoteDecimals,
        BigInt(pair.quoteLotSize)
      );
      setState(Object.freeze({
        scopeKey: capturedScope,
        stage: 'success',
        message: `Pool position #${confirmed.positionId} created. Current private claim: ${baseClaim} pUSDC + ${quoteClaim} pUSDT.`,
        confirmed
      }));
      scheduleFinalizedRefresh();
    } catch (error) {
      if (scopeRef.current === capturedScope) {
        setState(Object.freeze({ scopeKey: capturedScope, stage: 'error', message: actionError(error) }));
      }
    } finally {
      activeRef.current = false;
    }
  }, [
    baseAmount,
    quote.value,
    quoteAmount,
    requestConfirmation,
    runtime,
    scheduleFinalizedRefresh,
    scopeKey,
    sharedWalletSession
  ]);

  const busy = [
    'connecting-wallet',
    'switching-network',
    'unlocking-privacy',
    'setting-up-token',
    'refreshing-allowance',
    'approving-token',
    'signing',
    'confirming'
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
    : runtime.deployment.newActivityPaused
      ? 'New Pool activity paused'
      : !walletActionsAvailable
        ? 'Wallet unavailable'
        : !walletAddress
          ? 'Connect wallet'
          : !walletOnDexChain
            ? 'Switch to COTI Testnet'
            : busy
              ? visibleState.message
              : quote.error
                ? 'Check Pool maxima'
                : 'Review private Pool position';

  return Object.freeze({
    quote: quote.value,
    quoteError: quote.error,
    stage: visibleState.stage,
    message: visibleState.message,
    confirmed: visibleState.confirmed ?? null,
    busy,
    buttonLabel,
    canReview: runtime.status === 'ready' && !runtime.deployment.newActivityPaused &&
      walletActionsAvailable && (!walletAddress || !walletOnDexChain || Boolean(quote.value)) && !busy,
    review
  });
}
