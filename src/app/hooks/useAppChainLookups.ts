import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { fetchTradeSnapshotById } from '../../lib/appChain';
import {
  buildTradeSnapshotKey,
  DEFAULT_NICKNAME_MAX_BYTES,
  type Contact,
  type ConversationBlockRange,
  type TradeOfferMessagePayload,
  type TradeSnapshot
} from '../../lib/appShared';
import {
  fetchOnChainNicknames as fetchOnChainNicknamesLookup,
  getNicknameMaxLength as getNicknameMaxLengthLookup,
  loadMyNicknameFromChain as loadMyNicknameFromChainLookup,
  resolveConversationBlockRange as resolveConversationBlockRangeLookup,
  saveMyNicknameOnChain as saveMyNicknameOnChainLookup
} from '../../lib/appLookup';

type MemoSignerBundle = {
  signer: Wallet | JsonRpcSigner;
  cacheKey: string;
};

type UseAppChainLookupsArgs = {
  getMemoSigner: () => Promise<MemoSignerBundle>;
  loadMyNicknameFromChainRef: MutableRefObject<(address: string) => Promise<string>>;
  myNickname: string;
  nicknameMaxBytes: number;
  onChainNicknameCacheRef: MutableRefObject<Record<string, string | null>>;
  privateRewardTokenDecimals: number;
  privateRewardTokenSymbol: string;
  rewardTokenDecimals: number;
  rewardTokenSymbol: string;
  runSharedWalletTransactionFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  setContacts: Dispatch<SetStateAction<Contact[]>>;
  setError: (value: string) => void;
  setMyNickname: (value: string) => void;
  setNicknameMaxBytes: (value: number) => void;
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  setTradeSnapshotsById: Dispatch<SetStateAction<Record<string, TradeSnapshot>>>;
  tradeSnapshotsById: Record<string, TradeSnapshot>;
  walletAddress: string;
};

export default function useAppChainLookups({
  getMemoSigner,
  loadMyNicknameFromChainRef,
  myNickname,
  nicknameMaxBytes,
  onChainNicknameCacheRef,
  privateRewardTokenDecimals,
  privateRewardTokenSymbol,
  rewardTokenDecimals,
  rewardTokenSymbol,
  runSharedWalletTransactionFlow,
  setContacts,
  setError,
  setMyNickname,
  setNicknameMaxBytes,
  setSessionOnboardInfo,
  setTradeSnapshotsById,
  tradeSnapshotsById,
  walletAddress
}: UseAppChainLookupsArgs) {
  const nicknameMaxBytesRequestRef = useRef<Promise<number> | null>(null);
  const nicknameMaxBytesLoadedRef = useRef(nicknameMaxBytes !== DEFAULT_NICKNAME_MAX_BYTES);
  const resolveConversationBlockRangeRef = useRef<
    (contract: unknown, me: string, peer: string) => Promise<ConversationBlockRange | null>
  >(async () => null);

  const resolveTradeSnapshotForOffer = useCallback(
    async (offerMessage: TradeOfferMessagePayload): Promise<TradeSnapshot> => {
      const tradeKey = buildTradeSnapshotKey(offerMessage.tradeId, offerMessage.escrowContract);
      const existingSnapshot = tradeSnapshotsById[tradeKey];
      if (existingSnapshot) {
        return existingSnapshot;
      }

      const nextSnapshot = await fetchTradeSnapshotById(offerMessage.tradeId, {
        rewardTokenSymbol,
        rewardTokenDecimals,
        privateRewardTokenSymbol,
        privateRewardTokenDecimals,
        escrowContract: offerMessage.escrowContract,
        accessSecret: offerMessage.accessSecret
      });
      setTradeSnapshotsById((previous) => ({
        ...previous,
        [tradeKey]: nextSnapshot
      }));
      return nextSnapshot;
    },
    [
      privateRewardTokenDecimals,
      privateRewardTokenSymbol,
      rewardTokenDecimals,
      rewardTokenSymbol,
      setTradeSnapshotsById,
      tradeSnapshotsById
    ]
  );

  const getNicknameMaxLength = useCallback(
    async (): Promise<number> =>
      getNicknameMaxLengthLookup({
        nicknameMaxBytesLoadedRef,
        nicknameMaxBytesRequestRef,
        nicknameMaxBytes,
        setNicknameMaxBytes
      }),
    [nicknameMaxBytes, setNicknameMaxBytes]
  );

  const fetchOnChainNicknames = useCallback(
    async (addresses: string[]): Promise<Map<string, string>> =>
      fetchOnChainNicknamesLookup(addresses, {
        onChainNicknameCacheRef,
        getNicknameMaxLength
      }),
    [getNicknameMaxLength]
  );

  const saveMyNicknameOnChain = useCallback(
    async (overrideNickname?: string): Promise<boolean> =>
      runSharedWalletTransactionFlow(() =>
        saveMyNicknameOnChainLookup({
          walletAddress,
          nickname: myNickname,
          overrideNickname,
          getNicknameMaxLength,
          onChainNicknameCacheRef,
          getMemoSigner,
          setMyNickname,
          setContacts,
          setSessionOnboardInfo,
          setError
        })
      ),
    [
      getMemoSigner,
      getNicknameMaxLength,
      myNickname,
      runSharedWalletTransactionFlow,
      setContacts,
      setError,
      setMyNickname,
      setSessionOnboardInfo,
      walletAddress
    ]
  );

  const loadMyNicknameFromChain = useCallback(
    async (targetAddress: string, fallbackNickname?: string): Promise<string> =>
      loadMyNicknameFromChainLookup(targetAddress, fallbackNickname, fetchOnChainNicknames),
    [fetchOnChainNicknames]
  );
  loadMyNicknameFromChainRef.current = loadMyNicknameFromChain;

  const resolveConversationBlockRange = useCallback(
    async (contract: unknown, me: string, peer: string): Promise<ConversationBlockRange | null> =>
      resolveConversationBlockRangeLookup(contract, me, peer),
    []
  );
  resolveConversationBlockRangeRef.current = resolveConversationBlockRange;

  return {
    fetchOnChainNicknames,
    getNicknameMaxLength,
    loadMyNicknameFromChain,
    resolveConversationBlockRange,
    resolveConversationBlockRangeRef,
    resolveTradeSnapshotForOffer,
    saveMyNicknameOnChain
  };
}
