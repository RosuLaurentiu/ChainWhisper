import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import {
  CHAT_CONTRACT_ABI,
  CHAT_CONTRACT_ADDRESS,
  isWalletAddress,
  loadCotiEthersModule,
  loadCotiReadProvider,
  mergeOnboardInfo,
  normalizeContactName,
  parseConversationBlockRange,
  parseRecentPeersWithMetaResult,
  toSafeNumber,
  type Contact,
  type ConversationBlockRange,
  type RecentPeerMeta
} from './appShared';
import { CHAT_GC_RECENT_CONVERSATION_LIMIT, parseChatGcConversationRefs } from './chatGc';

type PromiseRef<T> = { current: Promise<T> | null };
type BooleanRef = { current: boolean };
type RecordRef<T> = { current: T };

type GetNicknameMaxLengthArgs = {
  nicknameMaxBytesLoadedRef: BooleanRef;
  nicknameMaxBytesRequestRef: PromiseRef<number>;
  nicknameMaxBytes: number;
  setNicknameMaxBytes: (value: number) => void;
};

type FetchOnChainNicknamesArgs = {
  onChainNicknameCacheRef: RecordRef<Record<string, string | null>>;
  getNicknameMaxLength: () => Promise<number>;
};

type MemoSignerBundle = {
  signer: Wallet | JsonRpcSigner;
  cacheKey: string;
};

type SaveMyNicknameOnChainArgs = {
  walletAddress: string;
  nickname: string;
  overrideNickname?: string;
  getNicknameMaxLength: () => Promise<number>;
  onChainNicknameCacheRef: RecordRef<Record<string, string | null>>;
  getMemoSigner: () => Promise<MemoSignerBundle>;
  setMyNickname: (value: string) => void;
  setContacts: (updater: (previous: Contact[]) => Contact[]) => void;
  setSessionOnboardInfo: (
    updater: (previous: Record<string, OnboardInfo>) => Record<string, OnboardInfo>
  ) => void;
  setError: (value: string) => void;
};

export const isAlreadyKnownTransactionError = (error: unknown): boolean => {
  const seen = new Set<unknown>();
  const stack: unknown[] = [error];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (typeof current === 'string') {
      if (current.toLowerCase().includes('already known')) {
        return true;
      }
      continue;
    }

    if (typeof current !== 'object') {
      continue;
    }

    for (const value of Object.values(current as Record<string, unknown>)) {
      stack.push(value);
    }
  }

  return false;
};

export const extractRawTransactionFromError = (error: unknown): string | undefined => {
  const seen = new Set<unknown>();
  const stack: unknown[] = [error];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (typeof current === 'string') {
      const rawTransaction = current.match(/0x[0-9a-fA-F]{100,}/)?.[0];
      if (rawTransaction) {
        return rawTransaction;
      }
      continue;
    }

    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }

    if (typeof current === 'object') {
      stack.push(...Object.values(current as Record<string, unknown>));
    }
  }

  return undefined;
};

const waitForKnownTransaction = async (
  cotiEthers: Awaited<ReturnType<typeof loadCotiEthersModule>>,
  error: unknown
): Promise<boolean> => {
  if (!isAlreadyKnownTransactionError(error)) {
    return false;
  }

  const rawTransaction = extractRawTransactionFromError(error);
  if (!rawTransaction || !cotiEthers.Transaction?.from) {
    return false;
  }

  try {
    const parsedTransaction = cotiEthers.Transaction.from(rawTransaction) as { hash?: string };
    const hash = parsedTransaction.hash;
    if (!hash || !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
      return false;
    }

    const readProvider = await loadCotiReadProvider(true);
    const receipt = await readProvider.waitForTransaction(hash, 1, 90_000);
    return Number((receipt as { status?: number | bigint } | null | undefined)?.status ?? 0) === 1;
  } catch {
    return false;
  }
};

export const getNicknameMaxLength = async ({
  nicknameMaxBytesLoadedRef,
  nicknameMaxBytesRequestRef,
  nicknameMaxBytes,
  setNicknameMaxBytes
}: GetNicknameMaxLengthArgs): Promise<number> => {
  if (nicknameMaxBytesLoadedRef.current) {
    return nicknameMaxBytes;
  }

  if (!nicknameMaxBytesRequestRef.current) {
    nicknameMaxBytesRequestRef.current = (async () => {
      try {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const readContract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, readProvider);
        const onChainMax = toSafeNumber(await readContract.NICKNAME_MAX_BYTES());
        if (onChainMax > 0) {
          setNicknameMaxBytes(onChainMax);
          nicknameMaxBytesLoadedRef.current = true;
          return onChainMax;
        }
      } catch {
      }

      return nicknameMaxBytes;
    })();
  }

  try {
    return await nicknameMaxBytesRequestRef.current;
  } finally {
    nicknameMaxBytesRequestRef.current = null;
  }
};

export const fetchOnChainNicknames = async (
  addresses: string[],
  { onChainNicknameCacheRef, getNicknameMaxLength }: FetchOnChainNicknamesArgs
): Promise<Map<string, string>> => {
  const uniqueAddresses = Array.from(
    new Set(
      addresses
        .map((address) => address.trim().toLowerCase())
        .filter((address) => isWalletAddress(address))
    )
  );
  if (uniqueAddresses.length === 0) {
    return new Map();
  }

  const cache = onChainNicknameCacheRef.current;
  const uncachedAddresses = uniqueAddresses.filter((address) => !Object.prototype.hasOwnProperty.call(cache, address));
  if (uncachedAddresses.length > 0) {
    const maxLength = await getNicknameMaxLength();
    const cotiEthers = await loadCotiEthersModule();
    const readProvider = await loadCotiReadProvider(true);
    const readContract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, readProvider);
    await Promise.all(
      uncachedAddresses.map(async (address) => {
        try {
          const raw = await readContract.nicknames(address);
          const normalized = normalizeContactName(String(raw ?? '').replace(/\r?\n/g, ''))?.slice(0, maxLength) ?? null;
          cache[address] = normalized;
        } catch {
          delete cache[address];
        }
      })
    );
  }

  const resolved = new Map<string, string>();
  for (const address of uniqueAddresses) {
    const cached = cache[address];
    if (typeof cached === 'string' && cached) {
      resolved.set(address, cached);
    }
  }
  return resolved;
};

export const saveMyNicknameOnChain = async ({
  walletAddress,
  nickname,
  overrideNickname,
  getNicknameMaxLength,
  onChainNicknameCacheRef,
  getMemoSigner,
  setMyNickname,
  setContacts,
  setSessionOnboardInfo,
  setError
}: SaveMyNicknameOnChainArgs): Promise<boolean> => {
  const address = walletAddress.trim().toLowerCase();
  if (!isWalletAddress(address)) {
    return false;
  }

  const maxLength = await getNicknameMaxLength();
  const nextNickname = normalizeContactName(
    (typeof overrideNickname === 'string' ? overrideNickname : nickname).replace(/\r?\n/g, '')
  )?.slice(0, maxLength);
  if (!nextNickname) {
    return false;
  }

  const cachedNickname = onChainNicknameCacheRef.current[address];
  if (cachedNickname === nextNickname) {
    return true;
  }

  const applySavedNickname = (cacheKey: string, signer: Wallet | JsonRpcSigner): void => {
    onChainNicknameCacheRef.current[address] = nextNickname;
    setMyNickname(nextNickname);
    setContacts((previous) =>
      previous.map((contact) =>
        contact.address.toLowerCase() === address ? { ...contact, name: nextNickname } : contact
      )
    );

    const nextOnboardInfo = signer.getUserOnboardInfo();
    setSessionOnboardInfo((previous) => ({
      ...previous,
      [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
    }));
  };

  try {
    const { signer, cacheKey } = await getMemoSigner();
    const cotiEthers = await loadCotiEthersModule();
    const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, signer);
    try {
      const tx = await contract.setMyNickname(nextNickname);
      await tx.wait();
    } catch (submitError) {
      const recovered = await waitForKnownTransaction(cotiEthers, submitError);
      if (!recovered) {
        throw submitError;
      }
    }

    applySavedNickname(cacheKey, signer);
    return true;
  } catch (nicknameError) {
    const message = isAlreadyKnownTransactionError(nicknameError)
      ? 'Nickname update is already pending. Wait for it to confirm, then refresh chat.'
      : nicknameError instanceof Error
        ? nicknameError.message
        : 'Failed to save nickname on chain.';
    setError(message);
    return false;
  }
};

export const loadMyNicknameFromChain = async (
  targetAddress: string,
  fallbackNickname: string | undefined,
  fetchNicknames: (addresses: string[]) => Promise<Map<string, string>>
): Promise<string> => {
  if (!isWalletAddress(targetAddress)) {
    return normalizeContactName(fallbackNickname ?? '') ?? '';
  }

  const lowerTargetAddress = targetAddress.toLowerCase();
  try {
    const names = await fetchNicknames([lowerTargetAddress]);
    const fromChain = names.get(lowerTargetAddress);
    if (fromChain) {
      return fromChain;
    }
  } catch {
  }

  return normalizeContactName(fallbackNickname ?? '') ?? '';
};

export const resolveRecentPeersWithMeta = async (contract: unknown, user: string): Promise<RecentPeerMeta[]> => {
  if (!isWalletAddress(user)) {
    return [];
  }

  const userKey = user.toLowerCase();
  const getRecentConversationsFn = (contract as {
    getRecentConversations?: (userArg: string, limitArg: number) => Promise<unknown>;
  }).getRecentConversations;
  if (getRecentConversationsFn) {
    try {
      const recentConversationsRaw = await getRecentConversationsFn(user, CHAT_GC_RECENT_CONVERSATION_LIMIT);
      const recentConversations = parseChatGcConversationRefs(recentConversationsRaw)
        .filter((peer) => peer.address.toLowerCase() !== userKey)
        .map(({ address, lastBlock, lastTime }) => ({ address, lastBlock, lastTime }));
      if (recentConversations.length > 0) {
        return recentConversations;
      }
    } catch {
    }
  }

  const getRecentPeersWithMetaFn = (contract as { getRecentPeersWithMeta?: (userArg: string) => Promise<unknown> })
    .getRecentPeersWithMeta;
  if (!getRecentPeersWithMetaFn) {
    return [];
  }

  try {
    const recentPeersRaw = await getRecentPeersWithMetaFn(user);
    return parseRecentPeersWithMetaResult(recentPeersRaw).filter((peer) => peer.address.toLowerCase() !== userKey);
  } catch {
    return [];
  }
};

export const resolveConversationBlockRange = async (
  contract: unknown,
  me: string,
  peer: string
): Promise<ConversationBlockRange | null> => {
  if (!isWalletAddress(me) || !isWalletAddress(peer)) {
    return null;
  }

  const getConversationBlockRangeFn = (contract as {
    getConversationBlockRange?: (meArg: string, peerArg: string) => Promise<unknown>;
  }).getConversationBlockRange;
  if (getConversationBlockRangeFn) {
    try {
      const rangeRaw = await getConversationBlockRangeFn(me, peer);
      const parsed = parseConversationBlockRange(rangeRaw);
      if (parsed) {
        return parsed;
      }
    } catch {
    }
  }

  const getLastBlockForConversationFn = (contract as {
    getLastBlockForConversation?: (meArg: string, peerArg: string) => Promise<unknown>;
  }).getLastBlockForConversation;
  if (!getLastBlockForConversationFn) {
    return null;
  }

  try {
    const lastBlock = toSafeNumber(await getLastBlockForConversationFn(me, peer));
    if (lastBlock <= 0) {
      return null;
    }

    const getFirstBlockForConversationFn = (contract as {
      getFirstBlockForConversation?: (meArg: string, peerArg: string) => Promise<unknown>;
    }).getFirstBlockForConversation;
    const firstBlockRaw = getFirstBlockForConversationFn
      ? await getFirstBlockForConversationFn(me, peer).catch(() => 0)
      : 0;
    const firstBlock = Math.max(0, Math.min(toSafeNumber(firstBlockRaw), lastBlock));
    return { firstBlock, lastBlock };
  } catch {
    return null;
  }
};
