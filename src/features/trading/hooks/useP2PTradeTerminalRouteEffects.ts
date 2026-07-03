import { useEffect, type MutableRefObject } from 'react';
import {
  buildTradeSnapshotKey,
  type TradeSnapshot
} from '../../../lib/appShared';
import { resolveTradeEscrowContractConfig } from '../../../lib/appChain';
import {
  doesAccessSecretMatchHash,
  normalizeAccessHash,
  PRIVATE_LINK_SECRET_MISMATCH_MESSAGE
} from '../../../lib/tradeLinks';
import { canUseWalletAuthorityForDirectAccess } from '../../../lib/tradeCounterSupport';
import { getSnapshotKey } from '../../../lib/p2pTradeView';
import {
  clearPendingOtcSwapIntent,
  readPendingOtcSwapIntentForTrade,
  type OtcSwapIntent
} from '../../../lib/otcSwapIntent';
import { normalizeAccessSecret } from './useP2PTradeRoute';
import {
  formatExactTokenAmountInput,
  parseTokenAmountString,
  type TerminalFillInputSide
} from '../components/P2PTradingPage.helpers';

type UseP2PTradeTerminalRouteEffectsArgs = {
  activeTerminalSwapIntentRef: MutableRefObject<OtcSwapIntent | null>;
  detailTrade: TradeSnapshot | null;
  forgetTradeAccessSecret: (tradeId: number, escrowContract?: string) => void;
  hashTradeAccessSecret: (accessSecret: string) => Promise<string>;
  rememberTradeAccessSecret: (tradeId: number, accessSecret: string, escrowContract?: string) => void;
  resolveKnownTradeAccessSecret: (tradeId: number, escrowContract?: string) => string;
  routeAccessSecret: string;
  routeEscrowContract?: string;
  routeTradeId: number | null;
  routeView: string;
  setRecurringBuyFillInput: (value: string) => void;
  setRecurringSellFillInput: (value: string) => void;
  setRecurringTerminalSide: (side: 'buy' | 'sell') => void;
  setTerminalBuyInput: (value: string) => void;
  setTerminalFillInputSide: (side: TerminalFillInputSide) => void;
  setTerminalHistorySheetKey: (value: string) => void;
  setTerminalPayInput: (value: string) => void;
  setTradeActionError: (message: string) => void;
  walletKey: string;
};

export default function useP2PTradeTerminalRouteEffects({
  activeTerminalSwapIntentRef,
  detailTrade,
  forgetTradeAccessSecret,
  hashTradeAccessSecret,
  rememberTradeAccessSecret,
  resolveKnownTradeAccessSecret,
  routeAccessSecret,
  routeEscrowContract,
  routeTradeId,
  routeView,
  setRecurringBuyFillInput,
  setRecurringSellFillInput,
  setRecurringTerminalSide,
  setTerminalBuyInput,
  setTerminalFillInputSide,
  setTerminalHistorySheetKey,
  setTerminalPayInput,
  setTradeActionError,
  walletKey
}: UseP2PTradeTerminalRouteEffectsArgs) {
  useEffect(() => {
    if (!detailTrade || routeTradeId === null) {
      return;
    }

    const detailKey = getSnapshotKey(detailTrade);
    const routeKey = buildTradeSnapshotKey(routeTradeId, routeEscrowContract);
    if (detailTrade.tradeId !== routeTradeId || detailKey !== routeKey) {
      return;
    }

    const routeSecret = normalizeAccessSecret(routeAccessSecret);
    const cachedSecret = normalizeAccessSecret(
      resolveKnownTradeAccessSecret(detailTrade.tradeId, detailTrade.escrowContract)
    );
    const candidateSecret = routeSecret || cachedSecret;
    if (!candidateSecret) {
      return;
    }

    let cancelled = false;
    const validateCandidateSecret = async () => {
      let directCounterWithoutAccessHash = false;
      try {
        if (canUseWalletAuthorityForDirectAccess(detailTrade, walletKey)) {
          return;
        }
        directCounterWithoutAccessHash = Boolean(
          resolveTradeEscrowContractConfig(detailTrade.escrowContract).directVisible &&
            detailTrade.counterParentTradeId &&
            !normalizeAccessHash(detailTrade.accessHash)
        );
      } catch {
        directCounterWithoutAccessHash = false;
      }
      if (directCounterWithoutAccessHash) {
        rememberTradeAccessSecret(detailTrade.tradeId, candidateSecret, detailTrade.escrowContract);
        return;
      }

      if (!detailTrade.hasAccessHash) {
        return;
      }

      if (!normalizeAccessHash(detailTrade.accessHash)) {
        forgetTradeAccessSecret(detailTrade.tradeId, detailTrade.escrowContract);
        if (routeSecret) {
          setTradeActionError('This unlisted link could not be verified. Open the full Share link from the maker and try again.');
        }
        return;
      }

      const candidateHash = await hashTradeAccessSecret(candidateSecret);
      const candidateMatches = doesAccessSecretMatchHash(
        candidateSecret,
        detailTrade.accessHash,
        () => candidateHash
      );
      if (cancelled) {
        return;
      }
      if (!candidateMatches) {
        forgetTradeAccessSecret(detailTrade.tradeId, detailTrade.escrowContract);
        if (routeSecret) {
          setTradeActionError(PRIVATE_LINK_SECRET_MISMATCH_MESSAGE);
        }
        return;
      }

      if (!cancelled) {
        rememberTradeAccessSecret(detailTrade.tradeId, candidateSecret, detailTrade.escrowContract);
      }
    };

    validateCandidateSecret().catch(() => {
      if (cancelled) {
        return;
      }
      forgetTradeAccessSecret(detailTrade.tradeId, detailTrade.escrowContract);
      if (routeSecret) {
        setTradeActionError('This unlisted link could not be verified. Open the full Share link from the maker and try again.');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    detailTrade,
    forgetTradeAccessSecret,
    hashTradeAccessSecret,
    rememberTradeAccessSecret,
    resolveKnownTradeAccessSecret,
    routeAccessSecret,
    routeEscrowContract,
    routeTradeId,
    setTradeActionError,
    walletKey
  ]);

  const detailTradeResetKey = detailTrade ? getSnapshotKey(detailTrade) : '';

  useEffect(() => {
    setTerminalFillInputSide('pay');
    setTerminalPayInput('');
    setTerminalBuyInput('');
    setTerminalHistorySheetKey('');
    activeTerminalSwapIntentRef.current = null;
  }, [
    activeTerminalSwapIntentRef,
    detailTradeResetKey,
    routeView,
    setTerminalBuyInput,
    setTerminalFillInputSide,
    setTerminalHistorySheetKey,
    setTerminalPayInput
  ]);

  useEffect(() => {
    if (routeView !== 'trade' || !detailTrade) {
      return;
    }
    const tradeKey = getSnapshotKey(detailTrade);
    const intent = readPendingOtcSwapIntentForTrade(tradeKey);
    if (!intent) {
      return;
    }
    const amountWei = parseTokenAmountString(intent.terminalInputAmountWei);
    if (amountWei <= 0n) {
      clearPendingOtcSwapIntent();
      return;
    }
    activeTerminalSwapIntentRef.current = intent;
    if (intent.terminalInput.kind === 'standard') {
      const decimals =
        intent.terminalInput.inputSide === 'buy' ? detailTrade.offer.decimals : detailTrade.request.decimals;
      const input = formatExactTokenAmountInput(amountWei, decimals);
      setTerminalFillInputSide(intent.terminalInput.inputSide === 'buy' ? 'buy' : 'pay');
      setTerminalBuyInput(intent.terminalInput.inputSide === 'buy' ? input : '');
      setTerminalPayInput(intent.terminalInput.inputSide === 'pay' ? input : '');
    } else if (detailTrade.recurringOrder) {
      const recurring = detailTrade.recurringOrder;
      const decimals =
        intent.terminalInput.fillSide === 'buy' ? recurring.baseAsset.decimals : recurring.quoteAsset.decimals;
      const input = formatExactTokenAmountInput(amountWei, decimals);
      setRecurringTerminalSide(intent.terminalInput.displayAction);
      if (intent.terminalInput.fillSide === 'buy') {
        setRecurringBuyFillInput(input);
        setRecurringSellFillInput('');
      } else {
        setRecurringSellFillInput(input);
        setRecurringBuyFillInput('');
      }
    }
    clearPendingOtcSwapIntent();
  }, [
    activeTerminalSwapIntentRef,
    detailTrade,
    detailTradeResetKey,
    routeView,
    setRecurringBuyFillInput,
    setRecurringSellFillInput,
    setRecurringTerminalSide,
    setTerminalBuyInput,
    setTerminalFillInputSide,
    setTerminalPayInput
  ]);
}
