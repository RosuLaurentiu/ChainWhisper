import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import { isInChatTradeOffer } from '../../../app/appHelpers';
import { fetchTradeSnapshotById } from '../../../lib/appChain';
import {
  buildTradeSnapshotKey,
  isWalletAddress,
  parseTradeOfferMessagePayload,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type ChatMessage,
  type TradeOfferMessagePayload,
  type TradeSnapshot
} from '../../../lib/appShared';

type UseActiveTradeOfferSnapshotsArgs = {
  activeMessages: ChatMessage[];
  privateRewardTokenDecimals: number;
  privateRewardTokenSymbol: string;
  rewardTokenDecimals: number;
  rewardTokenSymbol: string;
  setTradeSnapshotsById: Dispatch<SetStateAction<Record<string, TradeSnapshot>>>;
};

export default function useActiveTradeOfferSnapshots({
  activeMessages,
  privateRewardTokenDecimals,
  privateRewardTokenSymbol,
  rewardTokenDecimals,
  rewardTokenSymbol,
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
    if (!TRADE_ESCROW_CONTRACT_ADDRESS || !isWalletAddress(TRADE_ESCROW_CONTRACT_ADDRESS) || activeTradeOffers.length === 0) {
      return;
    }

    let cancelled = false;

    const loadTradeSnapshots = async () => {
      const nextSnapshots = await Promise.all(
        Array.from(
          new Map(
            activeTradeOffers.map((offer) => [
              buildTradeSnapshotKey(offer.tradeId, offer.escrowContract),
              offer
            ])
          ).values()
        ).map(async (offer) => {
          try {
            return await fetchTradeSnapshotById(offer.tradeId, {
              rewardTokenSymbol,
              rewardTokenDecimals,
              privateRewardTokenSymbol,
              privateRewardTokenDecimals,
              escrowContract: offer.escrowContract,
              accessSecret: offer.accessSecret
            });
          } catch {
            return null;
          }
        })
      );

      if (cancelled) {
        return;
      }

      setTradeSnapshotsById((previous) => {
        const next = { ...previous };
        for (const snapshot of nextSnapshots) {
          if (!snapshot) {
            continue;
          }
          next[buildTradeSnapshotKey(snapshot.tradeId, snapshot.escrowContract)] = snapshot;
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
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenDecimals,
    rewardTokenSymbol,
    setTradeSnapshotsById
  ]);
}
