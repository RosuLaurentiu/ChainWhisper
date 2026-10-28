import { useCallback, useEffect, useRef, useState } from 'react';
import { getProviderErrorMessage } from '../../../lib/appShared/core';
import {
  captureDexV2ActionIntent,
  type DexV2ActionIntent
} from '../../../lib/dexV2Actions';
import {
  confirmDexV2HiddenAction,
  submitDexV2HiddenAction,
  type ConfirmedDexV2HiddenAction
} from '../../../lib/dexV2HiddenExecution';
import {
  ensureDexV2InputAllowance,
  isDexV2AllowancePrivacyRefreshRequired
} from '../../../lib/dexV2PrivateToken';
import type { DexV2OwnedPosition } from '../../../lib/dexV2PositionDiscovery';
import {
  packDexV2LiquidityAdditionLots,
  packDexV2RecurringRanks,
  parseDexV2TokenAmountToLots
} from '../../../lib/dexV2Terms';
import type { TradeActionConfirmModel } from '../../../lib/tradeActionConfirm';
import type { SharedWalletSession } from '../../../lib/walletSession';
import type { DexV2RuntimeState } from './useDexV2Runtime';

type State = Readonly<{
  scopeKey: string;
  activePositionId: string | null;
  message: string;
  confirmed: ConfirmedDexV2HiddenAction | null;
}>;
const EMPTY: State = Object.freeze({ scopeKey: '', activePositionId: null, message: '', confirmed: null });

export default function useDexV2HiddenManagement({
  requestConfirmation,
  runtime,
  sharedWalletSession,
  refreshRuntime,
  refreshPositions
}: {
  requestConfirmation: (confirmation: TradeActionConfirmModel) => Promise<boolean>;
  runtime: DexV2RuntimeState;
  sharedWalletSession?: SharedWalletSession;
  refreshRuntime: () => void;
  refreshPositions: () => void;
}) {
  const scopeKey = runtime.status === 'ready'
    ? [runtime.deployment.manifest.manifestHash, sharedWalletSession?.walletAddress.trim().toLowerCase() ?? ''].join(':')
    : '';
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<State>(EMPTY);
  const visibleState = state.scopeKey === scopeKey ? state : EMPTY;
  useEffect(() => () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, []);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshRuntime();
      refreshPositions();
    }, 30_000);
  }, [refreshPositions, refreshRuntime]);

  const execute = useCallback(async ({
    position,
    mode,
    buyTickRank = 0,
    sellTickRank = 0,
    baseAmount = '0',
    quoteAmount = '0'
  }: {
    position: DexV2OwnedPosition;
    mode: 'pause' | 'resume' | 'close' | 'update-ranks' | 'add-liquidity';
    buyTickRank?: number;
    sellTickRank?: number;
    baseAmount?: string;
    quoteAmount?: string;
  }) => {
    const walletActions = sharedWalletSession?.actions;
    if (
      runtime.status !== 'ready' || !walletActions || !scopeKey ||
      visibleState.activePositionId || position.kind === 'pool'
    ) return;
    const pair = runtime.deployment.manifest.pair;
    let intent: DexV2ActionIntent;
    let allowances: Array<{ token: string; lots: bigint }> = [];
    let summaryRows: Array<{ label: string; value: string }> = [];
    try {
      const reference = {
        positionId: BigInt(position.positionId),
        expectedOwnerRevision: BigInt(position.ownerRevision)
      };
      if (mode === 'pause' || mode === 'resume' || mode === 'close') {
        const kind = position.kind === 'limit'
          ? mode === 'pause' ? 'pause-limit' : mode === 'resume' ? 'resume-limit' : 'close-limit'
          : mode === 'pause' ? 'pause-recurring' : mode === 'resume' ? 'resume-recurring' : 'close-recurring';
        intent = captureDexV2ActionIntent({ kind, ...reference });
      } else if (mode === 'update-ranks' && position.kind === 'recurring') {
        packDexV2RecurringRanks(buyTickRank, sellTickRank);
        intent = captureDexV2ActionIntent({
          kind: 'update-recurring-ranks', ...reference, buyTickRank, sellTickRank
        });
        summaryRows = [{ label: 'Private buy / sell ticks', value: `${buyTickRank} / ${sellTickRank}` }];
      } else if (mode === 'add-liquidity' && position.kind === 'recurring') {
        const parseOptional = (amount: string, decimals: number, lotSize: string) =>
          amount === '0' || amount === '' ? 0n : parseDexV2TokenAmountToLots(amount, decimals, BigInt(lotSize));
        const baseLots = parseOptional(baseAmount, pair.baseDecimals, pair.baseLotSize);
        const quoteLots = parseOptional(quoteAmount, pair.quoteDecimals, pair.quoteLotSize);
        packDexV2LiquidityAdditionLots(baseLots, quoteLots);
        intent = captureDexV2ActionIntent({
          kind: 'add-recurring-liquidity', ...reference, baseLots, quoteLots
        });
        allowances = [
          ...(baseLots > 0n ? [{ token: pair.baseToken, lots: baseLots }] : []),
          ...(quoteLots > 0n ? [{ token: pair.quoteToken, lots: quoteLots }] : [])
        ];
        summaryRows = [
          { label: 'Added pUSDC', value: baseAmount || '0' },
          { label: 'Added pUSDT', value: quoteAmount || '0' }
        ];
      } else {
        throw new Error('This hidden-position action does not apply to the selected position.');
      }
    } catch (error) {
      setState(Object.freeze({
        scopeKey, activePositionId: null,
        message: getProviderErrorMessage(error, 'Check the hidden-position action terms.'),
        confirmed: null
      }));
      return;
    }
    const label = mode === 'close' ? 'Close position' : mode === 'pause' ? 'Pause position' :
      mode === 'resume' ? 'Resume position' : mode === 'update-ranks' ? 'Update private ticks' : 'Add private liquidity';
    const accepted = await requestConfirmation(Object.freeze({
      title: `${label} #${position.positionId}`,
      message: mode === 'close'
        ? 'This returns the remaining private inventories and permanently burns the Position NFT.'
        : 'The action uses the current owner revision and fails if the position changed.',
      primaryLabel: mode === 'close' ? 'Close and withdraw' : 'Continue to wallet',
      fundingMoves: [],
      summaryRows: [{ label: 'Position', value: `${position.kind} #${position.positionId}` }, ...summaryRows],
      stats: [
        { label: 'Owner revision', value: position.ownerRevision },
        { label: 'Finality', value: '5 confirmations' }
      ]
    }));
    if (!accepted || scopeRef.current !== scopeKey) return;
    const capturedScope = scopeKey;
    setState(Object.freeze({ scopeKey, activePositionId: position.positionId, message: `${label}…`, confirmed: null }));
    try {
      const confirmed = await walletActions.runWalletTransactionFlow(async () => {
        let signer = await walletActions.getSigner(true);
        const ensureAllowances = async () => {
          for (const allowance of allowances) {
            await ensureDexV2InputAllowance({
              deployment: runtime.deployment,
              inputToken: allowance.token,
              maximumInputLots: allowance.lots,
              signer
            });
          }
        };
        try {
          await ensureAllowances();
        } catch (error) {
          if (!isDexV2AllowancePrivacyRefreshRequired(error)) throw error;
          signer = await walletActions.getSigner(true, { refreshAes: true });
          await ensureAllowances();
        }
        if (scopeRef.current !== capturedScope) throw new Error('The DEX position view changed before signing.');
        const submission = await submitDexV2HiddenAction({ deployment: runtime.deployment, intent, signer });
        setState(Object.freeze({
          scopeKey: capturedScope,
          activePositionId: position.positionId,
          message: 'Waiting for five confirmations and the private inventory snapshot…',
          confirmed: null
        }));
        return confirmDexV2HiddenAction({ deployment: runtime.deployment, signer, submission });
      });
      if (scopeRef.current !== capturedScope) return;
      setState(Object.freeze({
        scopeKey: capturedScope,
        activePositionId: null,
        message: `Position #${confirmed.positionId} is ${confirmed.lifecycle} at revision ${confirmed.ownerRevision}.`,
        confirmed
      }));
      scheduleRefresh();
    } catch (error) {
      if (scopeRef.current !== capturedScope) return;
      setState(Object.freeze({
        scopeKey: capturedScope,
        activePositionId: null,
        message: getProviderErrorMessage(error, 'The hidden-position owner action could not be completed.'),
        confirmed: null
      }));
    }
  }, [requestConfirmation, runtime, scheduleRefresh, scopeKey, sharedWalletSession, visibleState.activePositionId]);

  return Object.freeze({
    activePositionId: visibleState.activePositionId,
    message: visibleState.message,
    setPaused: (position: DexV2OwnedPosition, paused: boolean) => execute({ position, mode: paused ? 'pause' : 'resume' }),
    close: (position: DexV2OwnedPosition) => execute({ position, mode: 'close' }),
    updateRanks: (position: DexV2OwnedPosition, buyTickRank: number, sellTickRank: number) =>
      execute({ position, mode: 'update-ranks', buyTickRank, sellTickRank }),
    addLiquidity: (position: DexV2OwnedPosition, baseAmount: string, quoteAmount: string) =>
      execute({ position, mode: 'add-liquidity', baseAmount, quoteAmount })
  });
}
