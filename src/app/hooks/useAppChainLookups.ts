import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { resolveTradeAssetSnapshot } from '../../lib/appChain';
import type { DirectChatV2Runtime } from '../../lib/directChatV2Runtime';
import { resolveDirectTradeV2RuntimeReference, type DirectTradeV2Runtime } from '../../lib/directTradeV2Runtime';
import {
  buildTradeSnapshotKey,
  getProviderErrorMessage,
  isWalletAddress,
  type Contact,
  type TradeOfferMessagePayload,
  type TradeSnapshot
} from '../../lib/appShared';
import {
  DIRECT_CHAT_V2_NICKNAME_MAX_BYTES,
  normalizeDirectChatV2Nickname
} from '../../lib/directChatV2Chain';


type UseAppChainLookupsArgs = {
  directChatV2Runtime: DirectChatV2Runtime | null;
  directTradeV2Runtime: DirectTradeV2Runtime | null;
  directTradeV2Contracts?: readonly string[];
  loadMyNicknameFromChainRef: MutableRefObject<(address: string) => Promise<string>>;
  myNickname: string;
  nicknameMaxBytes: number;
  onChainNicknameCacheRef: MutableRefObject<Record<string, string | null>>;
  privateRewardTokenDecimals: number;
  privateRewardTokenSymbol: string;
  rewardTokenDecimals: number;
  rewardTokenSymbol: string;
  setContacts: Dispatch<SetStateAction<Contact[]>>;
  setError: (value: string) => void;
  setMyNickname: (value: string) => void;
  setNicknameMaxBytes: (value: number) => void;
  tradeSnapshotSessionScope: object;
  walletAddress: string;
};

export default function useAppChainLookups({
  directChatV2Runtime,
  directTradeV2Runtime,
  directTradeV2Contracts,
  loadMyNicknameFromChainRef,
  myNickname,
  nicknameMaxBytes,
  onChainNicknameCacheRef,
  privateRewardTokenDecimals,
  privateRewardTokenSymbol,
  rewardTokenDecimals,
  rewardTokenSymbol,
  setContacts,
  setError,
  setMyNickname,
  setNicknameMaxBytes,
  tradeSnapshotSessionScope,
  walletAddress
}: UseAppChainLookupsArgs) {
  const nicknameOwner = walletAddress.trim().toLowerCase();
  const nicknameScope = useMemo(() => ({ runtime: directChatV2Runtime, owner: nicknameOwner }),
    [directChatV2Runtime, nicknameOwner]);
  const currentNicknameScope = useRef(nicknameScope);
  if (currentNicknameScope.current !== nicknameScope) {
    currentNicknameScope.current = nicknameScope;
    onChainNicknameCacheRef.current = {};
  }
  const profileIsCurrent = useCallback(() => currentNicknameScope.current === nicknameScope && nicknameScope.runtime?.enabled &&
    nicknameScope.runtime.isCurrent() && nicknameScope.runtime.session.ownerAddress.toLowerCase() === nicknameScope.owner, [nicknameScope]);
  const tradeScope = useMemo(() => ({ session: tradeSnapshotSessionScope, runtime: directTradeV2Runtime, owner: nicknameOwner }),
    [tradeSnapshotSessionScope, directTradeV2Runtime, nicknameOwner]);
  const [tradeCache, setTradeCache] = useState<{ scope: typeof tradeScope; snapshots: Record<string, TradeSnapshot> }>(
    () => ({ scope: tradeScope, snapshots: {} }));
  const currentTradeCache = useRef(tradeCache);
  if (currentTradeCache.current.scope !== tradeScope) currentTradeCache.current = { scope: tradeScope, snapshots: {} };
  if (tradeCache.scope !== tradeScope) setTradeCache(currentTradeCache.current);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      currentTradeCache.current = { scope: currentTradeCache.current.scope, snapshots: {} };
    };
  }, []);
  const tradeIsCurrent = useCallback(() => mounted.current && currentTradeCache.current.scope === tradeScope &&
    Boolean(tradeScope.runtime?.isCurrent()) && tradeScope.runtime?.ownerAddress.toLowerCase() === tradeScope.owner, [tradeScope]);
  const setTradeSnapshotsById = useCallback<Dispatch<SetStateAction<Record<string, TradeSnapshot>>>>((next) => {
    if (!tradeIsCurrent()) return;
    const previous = currentTradeCache.current.snapshots;
    const snapshots = typeof next === 'function' ? next(previous) : next;
    if (!tradeIsCurrent()) return;
    const updated = { scope: tradeScope, snapshots };
    currentTradeCache.current = updated;
    setTradeCache(() => tradeIsCurrent() ? updated : currentTradeCache.current);
  }, [tradeIsCurrent, tradeScope]);
  const resolveTradeSnapshotForOffer = useCallback(
    async (
      offerMessage: TradeOfferMessagePayload,
      options: Readonly<{ allowPrivatePrompt?: boolean }> = {}
    ): Promise<TradeSnapshot> => {
      const tradeKey = buildTradeSnapshotKey(offerMessage.tradeId, offerMessage.escrowContract);
      const directContracts = directTradeV2Contracts ?? directTradeV2Runtime?.supportedContracts ??
        (directTradeV2Runtime ? [directTradeV2Runtime.contractAddress] : []);
      if (!directContracts.some(address => address.toLowerCase() === offerMessage.escrowContract.toLowerCase())) {
        throw new Error('Direct V2 offer references an unsupported deployment.');
      }
      const assertTradeCurrent = () => {
        if (!tradeIsCurrent()) throw new Error('Direct V2 offer is unavailable. Reconnect the owner wallet.');
      };
      assertTradeCurrent();
      const existingSnapshot = currentTradeCache.current.snapshots[tradeKey];
      const existingNeedsPrivateReveal = Boolean(
        existingSnapshot?.hiddenLiquidity &&
        (BigInt(existingSnapshot.offer.amount || '0') <= 0n ||
          BigInt(existingSnapshot.request.amount || '0') <= 0n)
      );
      if (existingSnapshot && !(existingNeedsPrivateReveal && options.allowPrivatePrompt !== false)) {
        return existingSnapshot;
      }

      if (!directTradeV2Runtime) throw new Error('Direct V2 offer is unavailable. Reconnect the owner wallet.');
      const directV2 = await resolveDirectTradeV2RuntimeReference(directTradeV2Runtime, {
        chainId: directTradeV2Runtime.deployment.chainId, contractAddress: offerMessage.escrowContract, orderId: String(offerMessage.tradeId)
      });
      assertTradeCurrent();
      const terms = await directV2.readTradeTerms(offerMessage.tradeId, {
        decryptPrivateAmounts: options.allowPrivatePrompt !== false
      });
      assertTradeCurrent();
      if (
        options.allowPrivatePrompt !== false &&
        (terms.offerAmount === undefined || terms.requestAmount === undefined)
      ) {
        throw new Error('Direct Trade V2 private terms could not be revealed to this participant.');
      }
      const assetType = (kind: typeof terms.offerAsset.assetType): number =>
        kind === 'native' ? 0 : kind === 'erc20' ? 1 : 2;
      const [offerAsset, requestAsset] = await Promise.all([
        resolveTradeAssetSnapshot(
          assetType(terms.offerAsset.assetType),
          terms.offerAsset.token,
          BigInt(terms.offerAmount ?? 0),
          rewardTokenSymbol,
          rewardTokenDecimals,
          privateRewardTokenSymbol,
          privateRewardTokenDecimals
        ),
        resolveTradeAssetSnapshot(
          assetType(terms.requestAsset.assetType),
          terms.requestAsset.token,
          BigInt(terms.requestAmount ?? 0),
          rewardTokenSymbol,
          rewardTokenDecimals,
          privateRewardTokenSymbol,
          privateRewardTokenDecimals
        )
      ]);
      assertTradeCurrent();
      const number = (value: string, label: string): number => {
        const parsed = BigInt(value);
        if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error(`${label} exceeds the app safe range.`);
        }
        return Number(parsed);
      };
      const offerAmount = BigInt(terms.offerAmount ?? 0);
      const requestAmount = BigInt(terms.requestAmount ?? 0);
      const accepted = terms.status === 'accepted';
      const parentTradeId = number(terms.parentTradeId, 'Direct parent trade ID');
      const replacementTradeId = number(terms.replacementTradeId, 'Direct replacement trade ID');
      const replacesTradeId = number(terms.replacesTradeId, 'Replaced Direct trade ID');
      const nextSnapshot: TradeSnapshot = {
        tradeId: number(terms.tradeId, 'Direct trade ID'),
        escrowContract: directV2.contractAddress,
        maker: terms.maker,
        taker: terms.taker,
        offer: offerAsset,
        request: requestAsset,
        createdAt: number(terms.createdAt, 'Direct trade creation time'),
        expiresAt: number(terms.expiresAt, 'Direct trade expiry'),
        status: terms.status,
        isPublic: false,
        parentTradeId: parentTradeId || undefined,
        counterParentEscrow: parentTradeId ? directV2.contractAddress : undefined,
        counterParentTradeId: parentTradeId || undefined,
        replacementTradeId: replacementTradeId || undefined,
        replacesTradeId: replacesTradeId || undefined,
        hiddenLiquidity: terms.amountMode === 'private',
        fillState: {
          remainingOfferAmount: accepted ? '0' : offerAmount.toString(),
          remainingRequestAmount: accepted ? '0' : requestAmount.toString(),
          filledOfferAmount: accepted ? offerAmount.toString() : '0',
          filledRequestAmount: accepted ? requestAmount.toString() : '0'
        }
      };
      setTradeSnapshotsById((previous) => ({ ...previous, [tradeKey]: nextSnapshot }));
      return nextSnapshot;
    },
    [
      privateRewardTokenDecimals,
      privateRewardTokenSymbol,
      directTradeV2Runtime,
      directTradeV2Contracts,
      rewardTokenDecimals,
      rewardTokenSymbol,
      setTradeSnapshotsById,
      tradeIsCurrent
    ]
  );

  const getNicknameMaxLength = useCallback(async (): Promise<number> => {
    if (currentNicknameScope.current === nicknameScope && nicknameMaxBytes !== DIRECT_CHAT_V2_NICKNAME_MAX_BYTES) {
      setNicknameMaxBytes(DIRECT_CHAT_V2_NICKNAME_MAX_BYTES);
    }
    return DIRECT_CHAT_V2_NICKNAME_MAX_BYTES;
  }, [nicknameScope, nicknameMaxBytes, setNicknameMaxBytes]);

  const fetchOnChainNicknames = useCallback(
    async (addresses: string[]): Promise<Map<string, string>> => {
      if (currentNicknameScope.current !== nicknameScope) return new Map();
      const runtime = nicknameScope.runtime;
      if (!runtime?.enabled || !profileIsCurrent()) return new Map();
      try {
        if (await runtime.session.hasProfileSync() && profileIsCurrent()) {
          const unique = Array.from(new Set(
            addresses.map((address) => address.trim().toLowerCase()).filter(isWalletAddress)
          ));
          const cache = onChainNicknameCacheRef.current;
          await Promise.all(unique.map(async (address) => {
            if (Object.prototype.hasOwnProperty.call(cache, address)) return;
            try {
              const nickname = await runtime.session.readNickname(address);
              if (profileIsCurrent() && cache === onChainNicknameCacheRef.current) cache[address] = nickname || null;
            } catch { /* An unavailable name is not an empty confirmed name. */ }
          }));
          if (!profileIsCurrent() || cache !== onChainNicknameCacheRef.current) return new Map();
          return new Map(unique.flatMap((address) => {
            const nickname = cache[address];
            return nickname ? [[address, nickname] as const] : [];
          }));
        }
      } catch { /* Keep the selected V2 source on an admission or RPC failure. */ }
      return new Map();
    },
    [nicknameScope, profileIsCurrent, onChainNicknameCacheRef]
  );

  const saveMyNicknameOnChain = useCallback(
    async (overrideNickname?: string): Promise<boolean> => {
      if (currentNicknameScope.current !== nicknameScope) return false;
      const address = walletAddress.trim().toLowerCase();
      if (!isWalletAddress(address)) return false;
      const runtime = nicknameScope.runtime;
      if (!runtime?.enabled || !profileIsCurrent()) {
        setError('Public names require the active ChainWhisper Chat V2 deployment.');
        return false;
      }
      try {
        if (!(await runtime.session.hasProfileSync())) {
          if (profileIsCurrent()) setError('Public names are unavailable on the selected Chat V2 deployment.');
          return false;
        }
        if (!profileIsCurrent()) return false;
        const nextNickname = normalizeDirectChatV2Nickname(
          typeof overrideNickname === 'string' ? overrideNickname : myNickname
        );
        if (onChainNicknameCacheRef.current[address] === nextNickname) return true;
        const confirmed = await runtime.session.setNickname(nextNickname);
        if (!profileIsCurrent()) return false;
        onChainNicknameCacheRef.current[address] = confirmed || null;
        setMyNickname(confirmed);
        setContacts((previous) => previous.map((contact) =>
          contact.address.toLowerCase() === address ? { ...contact, name: confirmed } : contact
        ));
        setError('');
        return true;
      } catch (error) {
        if (profileIsCurrent()) setError(getProviderErrorMessage(error, 'Public name update failed.'));
        return false;
      }
    },
    [
      nicknameScope,
      profileIsCurrent,
      myNickname,
      setContacts,
      setError,
      setMyNickname,
      walletAddress
    ]
  );

  const loadMyNicknameFromChain = useCallback(async (targetAddress: string): Promise<string> => {
    if (!isWalletAddress(targetAddress)) return '';
    const names = await fetchOnChainNicknames([targetAddress]);
    return names.get(targetAddress.toLowerCase()) ?? '';
  }, [fetchOnChainNicknames]);
  loadMyNicknameFromChainRef.current = loadMyNicknameFromChain;

  return {
    fetchOnChainNicknames,
    getNicknameMaxLength,
    loadMyNicknameFromChain,
    resolveTradeSnapshotForOffer,
    tradeSnapshotsById: tradeIsCurrent() ? currentTradeCache.current.snapshots : {},
    setTradeSnapshotsById,
    saveMyNicknameOnChain
  };
}
