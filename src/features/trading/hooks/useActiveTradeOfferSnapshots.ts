import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import { isInChatTradeOffer } from '../../../app/appHelpers';
import { isSupportedDirectTradeV2Escrow } from '../../../lib/directTradeV2Deployment';
import {
  buildTradeSnapshotKey,
  parseTradeOfferMessagePayload,
  type ChatMessage,
  type TradeOfferMessagePayload,
  type TradeSnapshot
} from '../../../lib/appShared';

type UseActiveTradeOfferSnapshotsArgs = {
  activeMessages: ChatMessage[];
  privateTermsEnabled: boolean;
  supportedEscrowContract?: string;
  supportedEscrowContracts?: readonly string[];
  resolveTradeSnapshotForOffer: (
    offer: TradeOfferMessagePayload,
    options?: Readonly<{ allowPrivatePrompt?: boolean }>
  ) => Promise<TradeSnapshot>;
  setTradeSnapshotsById: Dispatch<SetStateAction<Record<string, TradeSnapshot>>>;
};

export const loadActiveTradeOfferSnapshots = async ({
  offers,
  privateTermsEnabled,
  supportedEscrowContract,
  supportedEscrowContracts,
  resolveTradeSnapshotForOffer
}: {
  offers: readonly TradeOfferMessagePayload[];
  privateTermsEnabled: boolean;
  supportedEscrowContract?: string;
  supportedEscrowContracts?: readonly string[];
  resolveTradeSnapshotForOffer: (
    offer: TradeOfferMessagePayload,
    options?: Readonly<{ allowPrivatePrompt?: boolean }>
  ) => Promise<TradeSnapshot>;
}): Promise<TradeSnapshot[]> => {
  const uniqueOffers = Array.from(
    new Map(
      offers.map((offer) => [
        buildTradeSnapshotKey(offer.tradeId, offer.escrowContract),
        offer
      ])
    ).values()
  );
  const snapshots: TradeSnapshot[] = [];
  for (const offer of uniqueOffers) {
    if (!isSupportedDirectTradeV2Escrow(offer.escrowContract, supportedEscrowContracts, supportedEscrowContract)) {
      continue;
    }
    try {
      snapshots.push(await resolveTradeSnapshotForOffer(offer, {
        allowPrivatePrompt: privateTermsEnabled
      }));
    } catch {
      // A failed card must not block the remaining active offers.
    }
  }
  return snapshots;
};

export default function useActiveTradeOfferSnapshots({
  activeMessages,
  privateTermsEnabled,
  supportedEscrowContract,
  supportedEscrowContracts,
  resolveTradeSnapshotForOffer,
  setTradeSnapshotsById
}: UseActiveTradeOfferSnapshotsArgs) {
  const activeTradeOffers = useMemo(
    () =>
      activeMessages
        .map((message) => parseTradeOfferMessagePayload(message.text))
        .filter((message): message is TradeOfferMessagePayload => message !== null && isInChatTradeOffer(message)),
    [activeMessages]
  );

  useEffect(() => {
    if (activeTradeOffers.length === 0) {
      return;
    }

    let cancelled = false;

    const loadTradeSnapshots = async () => {
      const nextSnapshots = await loadActiveTradeOfferSnapshots({
        offers: activeTradeOffers,
        privateTermsEnabled,
        supportedEscrowContract,
        supportedEscrowContracts,
        resolveTradeSnapshotForOffer
      });

      if (cancelled) {
        return;
      }

      if (nextSnapshots.length === 0) {
        return;
      }

      setTradeSnapshotsById((previous) => {
        let next = previous;
        for (const snapshot of nextSnapshots) {
          const key = buildTradeSnapshotKey(snapshot.tradeId, snapshot.escrowContract);
          if (previous[key] === snapshot) continue;
          if (next === previous) next = { ...previous };
          next[key] = snapshot;
        }
        return next;
      });
    };

    loadTradeSnapshots().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    activeTradeOffers,
    privateTermsEnabled,
    supportedEscrowContract,
    supportedEscrowContracts,
    resolveTradeSnapshotForOffer,
    setTradeSnapshotsById
  ]);
}
