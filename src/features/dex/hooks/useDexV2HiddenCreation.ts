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
  quoteDexV2LimitPosition,
  quoteDexV2RecurringPosition
} from '../../../lib/dexV2HiddenTerms';
import {
  ensureDexV2InputAllowance,
  isDexV2AllowancePrivacyRefreshRequired
} from '../../../lib/dexV2PrivateToken';
import type { DexV2LimitMakerSide } from '../../../lib/dexV2Terms';
import type { TradeActionConfirmModel } from '../../../lib/tradeActionConfirm';
import type { SharedWalletSession } from '../../../lib/walletSession';
import type { DexV2RuntimeState } from './useDexV2Runtime';

type CreationState = Readonly<{
  scopeKey: string;
  activeKind: 'limit' | 'recurring' | null;
  message: string;
  confirmed: ConfirmedDexV2HiddenAction | null;
}>;

const EMPTY: CreationState = Object.freeze({
  scopeKey: '',
  activeKind: null,
  message: '',
  confirmed: null
});

export default function useDexV2HiddenCreation({
  requestConfirmation,
  runtime,
  sharedWalletSession,
  refresh
}: {
  requestConfirmation: (confirmation: TradeActionConfirmModel) => Promise<boolean>;
  runtime: DexV2RuntimeState;
  sharedWalletSession?: SharedWalletSession;
  refresh: () => void;
}) {
  const scopeKey = runtime.status === 'ready'
    ? [runtime.deployment.manifest.manifestHash, sharedWalletSession?.walletAddress.trim().toLowerCase() ?? ''].join(':')
    : '';
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<CreationState>(EMPTY);
  const visibleState = state.scopeKey === scopeKey ? state : EMPTY;

  useEffect(() => () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(refresh, 30_000);
  }, [refresh]);

  const execute = useCallback(async (request: Readonly<{
    kind: 'limit';
    makerSide: DexV2LimitMakerSide;
    tickRank: number;
    minimumFillQuanta: bigint;
    inventoryAmount: string;
  }> | Readonly<{
    kind: 'recurring';
    buyTickRank: number;
    sellTickRank: number;
    baseAmount: string;
    quoteAmount: string;
  }>) => {
    const walletActions = sharedWalletSession?.actions;
    if (
      runtime.status !== 'ready' ||
      !walletActions ||
      !scopeKey ||
      visibleState.activeKind ||
      runtime.deployment.newActivityPaused
    ) return;
    if (!sharedWalletSession?.walletAddress.trim()) {
      try {
        await walletActions.connectBrowserWallet(undefined, { preparePrivacy: true });
      } catch (error) {
        setState(Object.freeze({ scopeKey, activeKind: null, message: getProviderErrorMessage(error, 'The wallet did not connect.'), confirmed: null }));
      }
      return;
    }
    if (sharedWalletSession.chainId !== Number(runtime.deployment.manifest.chainId)) {
      try {
        await walletActions.runWalletTransactionFlow(() => walletActions.getSigner(false));
      } catch (error) {
        setState(Object.freeze({ scopeKey, activeKind: null, message: getProviderErrorMessage(error, 'The wallet did not switch networks.'), confirmed: null }));
      }
      return;
    }
    const pair = runtime.deployment.manifest.pair;
    let prepared: {
      intent: DexV2ActionIntent;
      allowances: Array<{ token: string; lots: bigint }>;
      summaryRows: Array<{ label: string; value: string }>;
    };
    try {
      prepared = request.kind === 'limit'
      ? (() => {
          const quote = quoteDexV2LimitPosition({ pair, ...request });
          return Object.freeze({
            intent: captureDexV2ActionIntent({
          kind: 'create-limit',
          makerSide: request.makerSide,
          tickRank: request.tickRank,
          minimumFillQuanta: request.minimumFillQuanta,
          inventoryLots: quote.inventoryLots
            }),
            allowances: [{ token: quote.inventoryToken, lots: quote.inventoryLots }],
            summaryRows: [
              { label: 'Maker side', value: request.makerSide === 'sell-base' ? 'Sell pUSDC' : 'Sell pUSDT' },
              { label: 'Private inventory', value: `${request.inventoryAmount} ${quote.inventorySymbol}` },
              { label: 'Private tick', value: `Tick ${request.tickRank}` },
              { label: 'Maker minimum', value: `${request.minimumFillQuanta.toString()} quanta` }
            ]
          });
        })()
      : (() => {
          const quote = quoteDexV2RecurringPosition({ pair, ...request });
          return Object.freeze({
            intent: captureDexV2ActionIntent({
          kind: 'create-recurring',
          buyTickRank: request.buyTickRank,
          sellTickRank: request.sellTickRank,
          baseInventoryLots: quote.baseInventoryLots,
          quoteInventoryLots: quote.quoteInventoryLots
            }),
            allowances: [
              { token: pair.baseToken, lots: quote.baseInventoryLots },
              { token: pair.quoteToken, lots: quote.quoteInventoryLots }
            ],
            summaryRows: [
              { label: 'Private pUSDC inventory', value: request.baseAmount },
              { label: 'Private pUSDT inventory', value: request.quoteAmount },
              { label: 'Private buy / sell ticks', value: `${request.buyTickRank} / ${request.sellTickRank}` }
            ]
          });
        })();
    } catch (error) {
      setState(Object.freeze({
        scopeKey,
        activeKind: null,
        message: getProviderErrorMessage(error, 'Check the private position terms.'),
        confirmed: null
      }));
      return;
    }
    const accepted = await requestConfirmation(Object.freeze({
      title: request.kind === 'limit' ? 'Create private Limit position' : 'Create private Recurring position',
      message: request.kind === 'limit'
        ? 'Side, tick, minimum fill, and inventory are authenticated as one private input. Only the Position NFT and immutable priority are public.'
        : 'Both private inventories and both ticks are authenticated for one reusable two-sided position.',
      primaryLabel: 'Continue to wallet',
      fundingMoves: [],
      summaryRows: prepared.summaryRows,
      stats: [
        { label: 'Hidden slots', value: '4 shared slots' },
        { label: 'Ownership', value: 'Position NFT' },
        { label: 'Finality', value: '5 confirmations' }
      ]
    }));
    if (!accepted || scopeRef.current !== scopeKey) return;
    const capturedScope = scopeKey;
    setState(Object.freeze({
      scopeKey: capturedScope,
      activeKind: request.kind,
      message: 'Preparing private inventories and allowances…',
      confirmed: null
    }));
    try {
      const confirmed = await walletActions.runWalletTransactionFlow(async () => {
        let signer = await walletActions.getSigner(true);
        const ensureAllowances = async () => {
          for (const allowance of prepared.allowances) {
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
        if (scopeRef.current !== capturedScope) throw new Error('The DEX position terms changed before signing.');
        const submission = await submitDexV2HiddenAction({ deployment: runtime.deployment, intent: prepared.intent, signer });
        setState(Object.freeze({
          scopeKey: capturedScope,
          activeKind: request.kind,
          message: 'Waiting for five confirmations and the private inventory snapshot…',
          confirmed: null
        }));
        return confirmDexV2HiddenAction({ deployment: runtime.deployment, signer, submission });
      });
      if (scopeRef.current !== capturedScope) return;
      setState(Object.freeze({
        scopeKey: capturedScope,
        activeKind: null,
        message: `${request.kind === 'limit' ? 'Limit' : 'Recurring'} position #${confirmed.positionId} created.`,
        confirmed
      }));
      scheduleRefresh();
    } catch (error) {
      if (scopeRef.current !== capturedScope) return;
      setState(Object.freeze({
        scopeKey: capturedScope,
        activeKind: null,
        message: getProviderErrorMessage(error, 'The private hidden position could not be created.'),
        confirmed: null
      }));
    }
  }, [requestConfirmation, runtime, scheduleRefresh, scopeKey, sharedWalletSession, visibleState.activeKind]);

  return Object.freeze({
    activeKind: visibleState.activeKind,
    message: visibleState.message,
    confirmed: visibleState.confirmed,
    createLimit: (request: Omit<Extract<Parameters<typeof execute>[0], { kind: 'limit' }>, 'kind'>) =>
      execute({ kind: 'limit', ...request }),
    createRecurring: (request: Omit<Extract<Parameters<typeof execute>[0], { kind: 'recurring' }>, 'kind'>) =>
      execute({ kind: 'recurring', ...request })
  });
}
