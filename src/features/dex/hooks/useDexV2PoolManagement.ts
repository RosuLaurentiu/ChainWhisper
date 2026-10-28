import { useCallback, useEffect, useRef, useState } from 'react';
import { getProviderErrorMessage } from '../../../lib/appShared/core';
import { captureDexV2ActionIntent } from '../../../lib/dexV2Actions';
import {
  confirmDexV2PoolMutation,
  submitDexV2PoolMutation,
  type ConfirmedDexV2PoolMutation
} from '../../../lib/dexV2PoolExecution';
import {
  ensureDexV2InputAllowance,
  isDexV2AllowancePrivacyRefreshRequired
} from '../../../lib/dexV2PrivateToken';
import type { DexV2OwnedPosition } from '../../../lib/dexV2PositionDiscovery';
import { quoteDexV2PoolDeposit } from '../../../lib/dexV2PoolTerms';
import type { TradeActionConfirmModel } from '../../../lib/tradeActionConfirm';
import type { SharedWalletSession } from '../../../lib/walletSession';
import type { DexV2RuntimeState } from './useDexV2Runtime';

type ManagementState = Readonly<{
  scopeKey: string;
  activePositionId: string | null;
  message: string;
  confirmed: ConfirmedDexV2PoolMutation | null;
}>;

const EMPTY: ManagementState = Object.freeze({
  scopeKey: '',
  activePositionId: null,
  message: '',
  confirmed: null
});

const actionError = (error: unknown): string => {
  const message = getProviderErrorMessage(error, 'The Pool owner action could not be completed.');
  if (/StalePositionRevision|position changed/iu.test(message)) {
    return 'This position changed. Refresh its finalized owner revision before trying again.';
  }
  if (/allowance|transfer amount exceeds|transferFrom/iu.test(message)) {
    return 'One of the private Pool token allowances is too small.';
  }
  return message;
};

export default function useDexV2PoolManagement({
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
  const [state, setState] = useState<ManagementState>(EMPTY);
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
    baseAmount = '',
    quoteAmount = '',
    shares = 0n
  }: {
    position: DexV2OwnedPosition;
    mode: 'add' | 'withdraw' | 'withdraw-all';
    baseAmount?: string;
    quoteAmount?: string;
    shares?: bigint;
  }) => {
    const walletActions = sharedWalletSession?.actions;
    if (
      runtime.status !== 'ready' ||
      !walletActions ||
      !scopeKey ||
      visibleState.activePositionId ||
      position.kind !== 'pool'
    ) return;
    if (sharedWalletSession?.chainId !== Number(runtime.deployment.manifest.chainId)) {
      setState(Object.freeze({
        scopeKey,
        activePositionId: null,
        message: 'Switch the connected wallet to COTI Testnet first.',
        confirmed: null
      }));
      return;
    }
    const pair = runtime.deployment.manifest.pair;
    let intent;
    let confirmation: TradeActionConfirmModel;
    if (mode === 'add') {
      const quote = quoteDexV2PoolDeposit({
        baseAmount,
        quoteAmount,
        baseDecimals: pair.baseDecimals,
        quoteDecimals: pair.quoteDecimals,
        baseLotSize: BigInt(pair.baseLotSize),
        quoteLotSize: BigInt(pair.quoteLotSize),
        maximumAggregateLots: BigInt(pair.maximumAggregateLots),
        poolEmpty: false
      });
      intent = captureDexV2ActionIntent({
        kind: 'add-pool',
        positionId: BigInt(position.positionId),
        expectedOwnerRevision: BigInt(position.ownerRevision),
        baseMaximumLots: quote.baseMaximumLots,
        quoteMaximumLots: quote.quoteMaximumLots
      });
      confirmation = Object.freeze({
        title: `Add liquidity to Pool #${position.positionId}`,
        message: 'Both maxima are encrypted. The Pool privately takes only the proportional amounts it can use.',
        primaryLabel: 'Continue to wallet',
        fundingMoves: [],
        summaryRows: [
          { label: 'Maximum pUSDC', value: `${baseAmount} pUSDC` },
          { label: 'Maximum pUSDT', value: `${quoteAmount} pUSDT` }
        ],
        stats: [
          { label: 'Owner revision', value: position.ownerRevision },
          { label: 'Allowances', value: 'Both tokens, exact maxima' },
          { label: 'Finality', value: '5 confirmations' }
        ]
      });
    } else if (mode === 'withdraw') {
      if (shares <= 0n) throw new Error('Choose at least one private Pool share to withdraw.');
      intent = captureDexV2ActionIntent({
        kind: 'withdraw-pool',
        positionId: BigInt(position.positionId),
        expectedOwnerRevision: BigInt(position.ownerRevision),
        shares
      });
      confirmation = Object.freeze({
        title: `Withdraw from Pool #${position.positionId}`,
        message: 'The share amount is encrypted. Your Position NFT remains open with its reduced private claim.',
        primaryLabel: 'Continue to wallet',
        fundingMoves: [],
        summaryRows: [{ label: 'Private shares', value: shares.toString() }],
        stats: [
          { label: 'Owner revision', value: position.ownerRevision },
          { label: 'Position NFT', value: 'Remains open' },
          { label: 'Finality', value: '5 confirmations' }
        ]
      });
    } else {
      intent = captureDexV2ActionIntent({
        kind: 'withdraw-all-pool',
        positionId: BigInt(position.positionId),
        expectedOwnerRevision: BigInt(position.ownerRevision)
      });
      confirmation = Object.freeze({
        title: `Close Pool position #${position.positionId}`,
        message: 'This withdraws the complete private claim and permanently burns the Position NFT.',
        primaryLabel: 'Withdraw all and close',
        fundingMoves: [],
        summaryRows: [{ label: 'Position', value: `Pool #${position.positionId}` }],
        stats: [
          { label: 'Owner revision', value: position.ownerRevision },
          { label: 'Position NFT', value: 'Burned permanently' },
          { label: 'Finality', value: '5 confirmations' }
        ]
      });
    }
    const accepted = await requestConfirmation(confirmation);
    if (!accepted || scopeRef.current !== scopeKey) return;
    const capturedScope = scopeKey;
    setState(Object.freeze({
      scopeKey: capturedScope,
      activePositionId: position.positionId,
      message: 'Preparing the private Pool owner action…',
      confirmed: null
    }));
    try {
      const confirmed = await walletActions.runWalletTransactionFlow(async () => {
        let signer = await walletActions.getSigner(true);
        if (mode === 'add') {
          const ensureAllowances = async () => {
            const decoded = mode === 'add' ? quoteDexV2PoolDeposit({
              baseAmount,
              quoteAmount,
              baseDecimals: pair.baseDecimals,
              quoteDecimals: pair.quoteDecimals,
              baseLotSize: BigInt(pair.baseLotSize),
              quoteLotSize: BigInt(pair.quoteLotSize),
              maximumAggregateLots: BigInt(pair.maximumAggregateLots),
              poolEmpty: false
            }) : null;
            if (!decoded) return;
            for (const token of [
              { address: pair.baseToken, lots: decoded.baseMaximumLots },
              { address: pair.quoteToken, lots: decoded.quoteMaximumLots }
            ]) {
              await ensureDexV2InputAllowance({
                deployment: runtime.deployment,
                inputToken: token.address,
                maximumInputLots: token.lots,
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
        }
        if (scopeRef.current !== capturedScope) throw new Error('The DEX position view changed before signing.');
        const submission = await submitDexV2PoolMutation({ deployment: runtime.deployment, intent, signer });
        setState(Object.freeze({
          scopeKey: capturedScope,
          activePositionId: position.positionId,
          message: 'Waiting for five confirmations and the updated private claim…',
          confirmed: null
        }));
        return confirmDexV2PoolMutation({ deployment: runtime.deployment, signer, submission });
      });
      if (scopeRef.current !== capturedScope) return;
      setState(Object.freeze({
        scopeKey: capturedScope,
        activePositionId: null,
        message: confirmed.closed
          ? `Pool position #${confirmed.positionId} closed and its NFT was burned.`
          : `Pool position #${confirmed.positionId} updated at owner revision ${confirmed.ownerRevision}.`,
        confirmed
      }));
      scheduleRefresh();
    } catch (error) {
      if (scopeRef.current !== capturedScope) return;
      setState(Object.freeze({
        scopeKey: capturedScope,
        activePositionId: null,
        message: actionError(error),
        confirmed: null
      }));
    }
  }, [
    requestConfirmation,
    runtime,
    scheduleRefresh,
    scopeKey,
    sharedWalletSession,
    visibleState.activePositionId
  ]);

  return Object.freeze({
    activePositionId: visibleState.activePositionId,
    message: visibleState.message,
    confirmed: visibleState.confirmed,
    add: (position: DexV2OwnedPosition, baseAmount: string, quoteAmount: string) =>
      execute({ position, mode: 'add', baseAmount, quoteAmount }),
    withdraw: (position: DexV2OwnedPosition, shares: bigint) => execute({ position, mode: 'withdraw', shares }),
    withdrawAll: (position: DexV2OwnedPosition) => execute({ position, mode: 'withdraw-all' })
  });
}
