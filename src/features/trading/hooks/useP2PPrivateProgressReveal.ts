import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { TradeSnapshot } from '../../../lib/appShared';
import type { P2PActionNoticeInput, P2PActionNoticeSurface } from '../../../lib/p2pActionNotice';
import {
  getSnapshotKey,
  getTradeTermsVisibility,
  hasHydratedDirectTradeTerms
} from '../../../lib/p2pTradeView';

type UseP2PPrivateProgressRevealArgs = {
  activeWalletKeyRef: MutableRefObject<string>;
  enrichMakerPrivateProgress: (snapshot: TradeSnapshot, forceRefresh?: boolean) => Promise<TradeSnapshot>;
  mergeTradeSnapshot: (snapshot: TradeSnapshot) => void;
  pushActionNotice: (notice: P2PActionNoticeInput) => void;
  setEditingRecurringOrder: Dispatch<SetStateAction<TradeSnapshot | null>>;
  setRevealingPrivateTradeKey: (tradeKey: string) => void;
  setTradeActionError: (message: string) => void;
  walletKey: string;
};

export default function useP2PPrivateProgressReveal({
  activeWalletKeyRef,
  enrichMakerPrivateProgress,
  mergeTradeSnapshot,
  pushActionNotice,
  setEditingRecurringOrder,
  setRevealingPrivateTradeKey,
  setTradeActionError,
  walletKey
}: UseP2PPrivateProgressRevealArgs) {
  return useCallback(
    async (snapshot: TradeSnapshot) => {
      const tradeKey = getSnapshotKey(snapshot);
      const noticeSurface: P2PActionNoticeSurface =
        getTradeTermsVisibility(snapshot) === 'direct-private-terms' ? 'terminal' : 'history';
      setTradeActionError('');
      try {
        if (!walletKey) {
          throw new Error('Connect the wallet that made or filled this private liquidity order.');
        }
        const revealWalletKey = walletKey;
        setRevealingPrivateTradeKey(tradeKey);
        pushActionNotice({ action: 'reveal', status: 'pending', surface: noticeSurface, tradeKey });
        const revealedSnapshot = await enrichMakerPrivateProgress(snapshot, true);
        if (activeWalletKeyRef.current !== revealWalletKey) {
          return;
        }
        if (getTradeTermsVisibility(snapshot) === 'direct-private-terms') {
          if (!hasHydratedDirectTradeTerms(revealedSnapshot)) {
            throw new Error('Direct amount snapshot could not be read for this wallet. Make sure this is your counter or received offer.');
          }
          mergeTradeSnapshot(revealedSnapshot);
          pushActionNotice({ action: 'reveal', status: 'success', surface: noticeSurface, tradeKey });
          return;
        }
        if (revealedSnapshot.recurringOrder) {
          const recurring = revealedSnapshot.recurringOrder;
          const hasRevealedInventory =
            recurring.makerPrivateInventory?.baseInventory !== undefined ||
            recurring.makerPrivateInventory?.quoteInventory !== undefined;
          const hasRevealedExecutions = Boolean(recurring.privateExecutions?.length);
          if (!hasRevealedInventory && !hasRevealedExecutions) {
            throw new Error('No private recurring liquidity or private buy/sell receipts were found for this wallet.');
          }
          mergeTradeSnapshot(revealedSnapshot);
          setEditingRecurringOrder((current) =>
            current && getSnapshotKey(current) === tradeKey ? revealedSnapshot : current
          );
          pushActionNotice({ action: 'reveal', status: 'success', surface: noticeSurface, tradeKey });
          return;
        }
        if (!revealedSnapshot.makerPrivateProgress && !revealedSnapshot.privateFillReceipts?.length) {
          throw new Error('Unable to reveal private history for this wallet. Make sure this is your trade and wallet privacy is unlocked.');
        }
        mergeTradeSnapshot(revealedSnapshot);
        pushActionNotice({ action: 'reveal', status: 'success', surface: noticeSurface, tradeKey });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to reveal this private liquidity order.';
        setTradeActionError(message);
        pushActionNotice({ action: 'reveal', message, status: 'error', surface: noticeSurface, tradeKey });
      } finally {
        setRevealingPrivateTradeKey('');
      }
    },
    [
      activeWalletKeyRef,
      enrichMakerPrivateProgress,
      mergeTradeSnapshot,
      pushActionNotice,
      setEditingRecurringOrder,
      setRevealingPrivateTradeKey,
      setTradeActionError,
      walletKey
    ]
  );
}
