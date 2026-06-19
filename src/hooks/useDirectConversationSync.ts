import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import { resolveRecentPeersWithMeta } from '../lib/appLookup';
import { mergeDirectHistoryEntries, resolveDirectUnreadState } from '../lib/directConversationSyncHelpers';
import { mergeDirectSyncOptions } from '../lib/directSyncPlan';
import {
  applyConversationPreferenceStateToContact,
  AUTO_STATE_BACKUP_BLOCK_DISTANCE,
  AUTO_STATE_BACKUP_RETRY_BLOCKS,
  CHAT_CONTRACT_ABI,
  CHAT_CONTRACT_ADDRESS,
  debugLog,
  extractUserCiphertext,
  isWalletAddress,
  loadCotiEthersModule,
  loadCotiReadProvider,
  mergeOnboardInfo,
  mergeUniqueContacts,
  normalizeConversationPreferenceState,
  normalizeLastReadAllTs,
  parseChatMessagePayload,
  parseStateBackupText,
  type BackupLocalStateOptions,
  type ChatMessage,
  type Contact,
  type ConversationBlockRange,
  type ConversationPreferenceState,
  type HistoryEntry,
  type RecentPeerMeta,
  type StateBackupPayload,
  type SyncConversationOptions
} from '../lib/appShared';
import {
  buildChatGcMessageKey,
  CHAT_GC_DEEP_THREAD_PAGE_SIZE,
  CHAT_GC_THREAD_PAGE_SIZE,
  normalizeChatGcMessageId,
  parseChatGcMessageView,
  type ChatGcMessageView
} from '../lib/chatGc';
import type { WalletReadAccount } from '../lib/walletAccountScope';

type StateSetter<T> = (next: T | ((previous: T) => T)) => void;
type MemoSignerBundle = {
  signer: Wallet | JsonRpcSigner;
  cacheKey: string;
};
type BlockTimestampProvider = {
  getBlock: (blockNumber: number) => Promise<{ timestamp?: unknown } | null | undefined>;
};

type UseDirectConversationSyncArgs = {
  activeContact: string | null;
  activeGroupId: number | null;
  activeMessagesLength: number;
  applyStateBackupPayload: (walletKey: string, payload: StateBackupPayload, backupBlockNumber?: number) => void;
  backupLocalStateToSelf: (options?: BackupLocalStateOptions) => Promise<void>;
  chainId: number | null;
  contacts: Contact[];
  currentWalletKeyRef: MutableRefObject<string>;
  decryptMemoPlaintextWithRecovery: (
    signer: Wallet | JsonRpcSigner,
    cacheKey: string,
    ciphertext: unknown
  ) => Promise<string>;
  fetchOnChainNicknames: (addresses: string[]) => Promise<Map<string, string>>;
  getMemoSigner: () => Promise<MemoSignerBundle>;
  getMemoSignerForAccount?: (account: WalletReadAccount) => Promise<MemoSignerBundle>;
  hasAesReady: boolean;
  lastAutoBackupAttemptBlockRef: MutableRefObject<Record<string, number>>;
  lastReadAllTsRef: MutableRefObject<number>;
  lastReadByContactRef: MutableRefObject<Record<string, number>>;
  lastStateBackupBlockRef: MutableRefObject<Record<string, number>>;
  messagesByContact: Record<string, ChatMessage[]>;
  notificationSuppressedContactAddressSet: Set<string>;
  parseEncryptedChatMessagePayload: (
    signer: Wallet | JsonRpcSigner,
    cacheKey: string,
    ciphertext: unknown
  ) => Promise<ReturnType<typeof parseChatMessagePayload>>;
  pinnedContactStateRef: MutableRefObject<Map<string, { muted?: boolean; hidden?: boolean }>>;
  readStateFeaturesEnabled: boolean;
  resolveBlockTimestampMap: (
    readProvider: BlockTimestampProvider,
    blockNumbers: Iterable<number>
  ) => Promise<Map<number, number>>;
  resolveConversationBlockRange: (
    contract: unknown,
    me: string,
    peer: string
  ) => Promise<ConversationBlockRange | null>;
  setContacts: Dispatch<SetStateAction<Contact[]>>;
  setError: (value: string) => void;
  setLoadingOlderHistory: StateSetter<boolean>;
  setMessagesByContact: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  setSyncingHistory: StateSetter<boolean>;
  setUnreadMap: StateSetter<Record<string, boolean>>;
  unreadMapRef: MutableRefObject<Record<string, boolean>>;
  walletAddress: string;
  readAccounts?: WalletReadAccount[];
};

type ParsedDirectMessage = {
  entry?: HistoryEntry;
  contactAddress: string;
  contactName?: string;
  conversationState?: ConversationPreferenceState;
  latestIncomingTime?: number;
};

const toMessageIdArray = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map(normalizeChatGcMessageId).filter((messageId): messageId is string => Boolean(messageId));
};

const readConversationMessageCount = async (contract: unknown, walletAddress: string, peerAddress: string): Promise<number> => {
  const countRaw = await (contract as {
    conversationMessageCount: (me: string, peer: string) => Promise<unknown>;
  }).conversationMessageCount(walletAddress, peerAddress);
  const count = Number(countRaw);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
};

const readConversationMessageIds = async (
  contract: unknown,
  walletAddress: string,
  peerAddress: string,
  offset: number,
  limit: number
): Promise<string[]> => {
  if (limit <= 0) {
    return [];
  }
  const idsRaw = await (contract as {
    getConversationMessagePage: (me: string, peer: string, offset: number, limit: number) => Promise<unknown>;
  }).getConversationMessagePage(walletAddress, peerAddress, Math.max(0, offset), Math.max(0, limit));
  return toMessageIdArray(idsRaw);
};

const readMessageView = async (
  contract: unknown,
  messageId: string,
  viewerAddress: string
): Promise<ChatGcMessageView | null> => {
  try {
    const raw = await (contract as {
      getMessage: (messageId: string, options?: { from?: string }) => Promise<unknown>;
    }).getMessage(messageId, { from: viewerAddress });
    return parseChatGcMessageView(raw);
  } catch {
    return null;
  }
};

const readMessageChunk = async (
  contract: unknown,
  messageId: string,
  chunkIndex: number,
  viewerAddress: string
): Promise<unknown> => {
  return (contract as {
    getMessageChunk: (messageId: string, chunkIndex: number, options?: { from?: string }) => Promise<unknown>;
}).getMessageChunk(messageId, chunkIndex, { from: viewerAddress });
};

const resolveReadableDirectAccounts = (
  walletAddress: string,
  hasAesReady: boolean,
  readAccounts?: WalletReadAccount[]
): WalletReadAccount[] => {
  if (readAccounts && readAccounts.length > 0) {
    return readAccounts
      .filter((account) => account.canReadPrivate && isWalletAddress(account.address))
      .map((account) => ({
        ...account,
        key: account.key || account.address.toLowerCase()
      }));
  }

  const normalized = walletAddress.trim();
  return hasAesReady && isWalletAddress(normalized)
    ? [
        {
          address: normalized,
          canReadPrivate: true,
          isActionAccount: true,
          key: normalized.toLowerCase(),
          label: 'ChainWhisper account',
          role: 'chainwhisper'
        }
      ]
    : [];
};

const buildPerAccountContactKey = (accountKey: string, contactKey: string): string => `${accountKey}:${contactKey}`;

export default function useDirectConversationSync(args: UseDirectConversationSyncArgs) {
  const argsRef = useRef(args);
  argsRef.current = args;

  const syncingHistoryRef = useRef(false);
  const pendingSyncOptionsRef = useRef<SyncConversationOptions | null>(null);
  const lastSyncedBlockRef = useRef<Record<string, number>>({});
  const lastActiveContactSyncedBlockRef = useRef<Record<string, number>>({});
  const oldestLoadedOffsetByContactRef = useRef<Record<string, number>>({});
  const hasOlderHistoryByContactRef = useRef<Record<string, boolean>>({});
  const loadingOlderHistoryRef = useRef(false);
  const autoPrefetchedRecentHistoryByContactRef = useRef<Record<string, boolean>>({});
  const syncConversationHistoryImplRef = useRef<(options?: SyncConversationOptions) => Promise<void>>(async () => {});
  const loadOlderMessagesForActiveContactImplRef = useRef<() => Promise<void>>(async () => {});

  const resetConversationHistoryCaches = useCallback(() => {
    lastSyncedBlockRef.current = {};
    lastActiveContactSyncedBlockRef.current = {};
    oldestLoadedOffsetByContactRef.current = {};
    hasOlderHistoryByContactRef.current = {};
    autoPrefetchedRecentHistoryByContactRef.current = {};
  }, []);

  const syncConversationHistory = useCallback(
    (options?: SyncConversationOptions) => syncConversationHistoryImplRef.current(options),
    []
  );

  const loadOlderMessagesForActiveContact = useCallback(
    () => loadOlderMessagesForActiveContactImplRef.current(),
    []
  );

  const loadFullConversationHistory = useCallback(async () => {
    if (syncingHistoryRef.current) {
      return;
    }

    await syncConversationHistory({ deep: true });
  }, [syncConversationHistory]);

  const parseMessageById = useCallback(
    async (
      contract: unknown,
      messageId: string,
      requestedWalletAddress: string,
      signer: Wallet | JsonRpcSigner,
      cacheKey: string,
      readAccount?: WalletReadAccount
    ): Promise<ParsedDirectMessage | null> => {
      const walletKey = requestedWalletAddress.toLowerCase();
      const view = await readMessageView(contract, messageId, requestedWalletAddress);
      if (!view) {
        return null;
      }

      const fromKey = view.from.toLowerCase();
      const toKey = view.to.toLowerCase();
      if (fromKey !== walletKey && toKey !== walletKey) {
        return null;
      }

      const direction: HistoryEntry['direction'] = fromKey === walletKey ? 'outgoing' : 'incoming';
      const contactAddress = direction === 'outgoing' ? view.to : view.from;
      const contactKey = contactAddress.toLowerCase();
      const messageKey = buildChatGcMessageKey(view.id);
      const logIndex = view.idNumber;
      let plaintext = '(Unable to decrypt message)';

      try {
        const parts: string[] = [];
        const firstCiphertext = extractUserCiphertext(view.ciphertext);
        if (firstCiphertext && firstCiphertext.value.length > 0) {
          parts.push(await argsRef.current.decryptMemoPlaintextWithRecovery(signer, cacheKey, firstCiphertext));
        }
        for (let chunkIndex = 1; chunkIndex < view.chunkCount; chunkIndex += 1) {
          const chunk = await readMessageChunk(contract, view.id, chunkIndex, requestedWalletAddress);
          const chunkCiphertext = extractUserCiphertext(chunk);
          if (!chunkCiphertext || chunkCiphertext.value.length === 0) {
            continue;
          }
          parts.push(await argsRef.current.decryptMemoPlaintextWithRecovery(signer, cacheKey, chunkCiphertext));
        }
        if (parts.length > 0) {
          plaintext = parts.join('');
        }
      } catch {
        plaintext = '(Unable to decrypt message)';
      }

      if (direction === 'outgoing' && contactKey === walletKey) {
        const backupPayload = parseStateBackupText(plaintext);
        if (backupPayload) {
          return null;
        }
      }

      const parsedMessage = parseChatMessagePayload(plaintext);
      const normalizedState = normalizeConversationPreferenceState(parsedMessage.embeddedConversationState);
      const shouldSuppressVisibleRow =
        parsedMessage.cleanText.trim().length === 0 &&
        (parsedMessage.embeddedContactName || parsedMessage.embeddedConversationState);

      return {
        contactAddress,
        contactName:
          direction === 'incoming'
            ? parsedMessage.embeddedNickname
            : parsedMessage.embeddedContactName ?? parsedMessage.embeddedNickname,
        conversationState: normalizedState,
        latestIncomingTime: direction === 'incoming' ? view.timestamp || view.blockNumber : undefined,
        entry: shouldSuppressVisibleRow
          ? undefined
          : {
              id: messageKey,
              contact: contactAddress,
              direction,
              text: parsedMessage.cleanText,
              accountAddress: readAccount?.address ?? requestedWalletAddress,
              accountRole: readAccount?.role,
              replyToMessageId: parsedMessage.replyToMessageId,
              replyToText: parsedMessage.replyToText,
              replyToTxHash: parsedMessage.replyToTxHash,
              replyToBlockNumber: parsedMessage.replyToBlockNumber,
              replyToLogIndex: parsedMessage.replyToLogIndex,
              reactionToTxHash: parsedMessage.embeddedReaction?.targetTxHash,
              reactionToBlockNumber: parsedMessage.embeddedReaction?.targetBlockNumber,
              reactionToLogIndex: parsedMessage.embeddedReaction?.targetLogIndex,
              reactionEmoji: parsedMessage.embeddedReaction?.emoji,
              tradeReference: parsedMessage.tradeReference,
              txHash: messageKey,
              blockNumber: view.blockNumber,
              logIndex,
              timestamp: view.timestamp
            }
      };
    },
    []
  );

  syncConversationHistoryImplRef.current = async (options?: SyncConversationOptions) => {
    const {
      backupLocalStateToSelf,
      chainId,
      contacts,
      currentWalletKeyRef,
      fetchOnChainNicknames,
      getMemoSigner,
      getMemoSignerForAccount,
      hasAesReady,
      lastAutoBackupAttemptBlockRef,
      lastReadAllTsRef,
      lastReadByContactRef,
      lastStateBackupBlockRef,
      notificationSuppressedContactAddressSet,
      pinnedContactStateRef,
      readStateFeaturesEnabled,
      setContacts,
      setError,
      setMessagesByContact,
      setSessionOnboardInfo,
      setSyncingHistory,
      setUnreadMap,
      unreadMapRef,
      walletAddress,
      readAccounts
    } = argsRef.current;

    setError('');
    debugLog('[sync] ChatGC start', { walletAddress, options, hasAesReady, chainId });

    const requestedWalletAddress = walletAddress.trim();
    const requestedWalletKey = requestedWalletAddress.toLowerCase();
    const readableAccounts = resolveReadableDirectAccounts(walletAddress, hasAesReady, readAccounts);
    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress) || readableAccounts.length === 0) {
      return;
    }

    if (syncingHistoryRef.current) {
      pendingSyncOptionsRef.current = mergeDirectSyncOptions(options, pendingSyncOptionsRef.current);
      return;
    }

    try {
      const runInBackground = Boolean(options?.background);
      syncingHistoryRef.current = true;
      if (!runInBackground) {
        setSyncingHistory(true);
      }

      const cotiEthers = await loadCotiEthersModule();
      const readProvider = await loadCotiReadProvider(true);
      const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, readProvider);
      const latestBlock = await readProvider.getBlockNumber();
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const activeContactAddress = argsRef.current.activeContact?.trim() ?? '';
      const useActiveContactOnly =
        Boolean(options?.activeContactOnly) &&
        !options?.contactsOnly &&
        !options?.deep &&
        isWalletAddress(activeContactAddress);
      const shouldLoadContactPreviews = Boolean(options?.contactsOnly && options?.previewPerContact);
      const entries: HistoryEntry[] = [];
      const discoveredContacts = new Set<string>();
      const discoveredNicknames = new Map<string, string>();
      const discoveredConversationStates = new Map<string, ConversationPreferenceState>();
      const latestIncomingMessageTimeByContact = new Map<string, number>();
      const recentPeersByAccount = new Map<string, RecentPeerMeta[]>();
      const signerBundles: Array<{ account: WalletReadAccount; signer: Wallet | JsonRpcSigner; cacheKey: string }> = [];

      for (const account of readableAccounts) {
        try {
          const signerBundle = getMemoSignerForAccount
            ? await getMemoSignerForAccount(account)
            : await getMemoSigner();
          signerBundles.push({ account, ...signerBundle });
        } catch (signerError) {
          if (account.isActionAccount) {
            throw signerError;
          }
          debugLog('[sync] skipped unreadable owner account', {
            account: account.address,
            reason: signerError instanceof Error ? signerError.message : String(signerError)
          });
        }
      }

      if (signerBundles.length === 0) {
        return;
      }

      for (const { account, signer, cacheKey } of signerBundles) {
        const accountAddress = account.address.trim();
        const accountKey = account.key || accountAddress.toLowerCase();
        const recentPeersWithMeta = useActiveContactOnly
          ? []
          : await resolveRecentPeersWithMeta(contract, accountAddress);
        recentPeersByAccount.set(accountKey, recentPeersWithMeta);
        const peersToRead = new Map<string, string>();
        const addPeer = (address?: string | null) => {
          const normalized = address?.trim() ?? '';
          if (!isWalletAddress(normalized) || normalized.toLowerCase() === accountKey) {
            return;
          }
          peersToRead.set(normalized.toLowerCase(), normalized);
          discoveredContacts.add(normalized);
        };

        if (useActiveContactOnly) {
          addPeer(activeContactAddress);
        } else {
          for (const peer of recentPeersWithMeta) {
            addPeer(peer.address);
          }
          if (options?.deep) {
            contacts.forEach((contact) => addPeer(contact.address));
          }
        }

        if (!options?.contactsOnly || shouldLoadContactPreviews || useActiveContactOnly) {
          for (const peerAddress of peersToRead.values()) {
            const peerKey = peerAddress.toLowerCase();
            const cacheContactKey = buildPerAccountContactKey(accountKey, peerKey);
            const count = await readConversationMessageCount(contract, accountAddress, peerAddress).catch(() => 0);
            if (count <= 0) {
              hasOlderHistoryByContactRef.current[cacheContactKey] = false;
              continue;
            }

            const limit = shouldLoadContactPreviews
              ? 1
              : Math.min(options?.deep ? CHAT_GC_DEEP_THREAD_PAGE_SIZE : CHAT_GC_THREAD_PAGE_SIZE, count);
            const offset = Math.max(0, count - limit);
            const ids = await readConversationMessageIds(contract, accountAddress, peerAddress, offset, limit);
            oldestLoadedOffsetByContactRef.current[cacheContactKey] = offset;
            hasOlderHistoryByContactRef.current[cacheContactKey] = offset > 0;

            for (const messageId of ids) {
              const parsed = await parseMessageById(contract, messageId, accountAddress, signer, cacheKey, account);
              if (!parsed) {
                continue;
              }
              discoveredContacts.add(parsed.contactAddress);
              if (parsed.entry) {
                entries.push(parsed.entry);
              }
              if (parsed.contactName) {
                discoveredNicknames.set(parsed.contactAddress.toLowerCase(), parsed.contactName);
              }
              if (parsed.conversationState) {
                discoveredConversationStates.set(parsed.contactAddress.toLowerCase(), parsed.conversationState);
              }
              if (typeof parsed.latestIncomingTime === 'number' && parsed.latestIncomingTime > 0) {
                const latestExisting = latestIncomingMessageTimeByContact.get(parsed.contactAddress.toLowerCase()) ?? 0;
                latestIncomingMessageTimeByContact.set(
                  parsed.contactAddress.toLowerCase(),
                  Math.max(latestExisting, parsed.latestIncomingTime)
                );
              }
            }
          }
        }
      }

      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      if (entries.length > 0) {
        setMessagesByContact((previous) =>
          mergeDirectHistoryEntries(previous, entries, requestedWalletAddress, {
            pruneOptimisticOutgoing: true
          })
        );
      }

      const onChainNicknames =
        discoveredContacts.size > 0 ? await fetchOnChainNicknames(Array.from(discoveredContacts)) : new Map<string, string>();
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      if (discoveredContacts.size > 0 || discoveredNicknames.size > 0 || discoveredConversationStates.size > 0) {
        setContacts((previous) => {
          let nextContacts = mergeUniqueContacts(previous, Array.from(discoveredContacts));
          nextContacts = nextContacts.map((contact) => {
            const key = contact.address.toLowerCase();
            let nextContact = contact;
            const nickname = discoveredNicknames.get(key) ?? onChainNicknames.get(key);
            if (nickname && contact.name !== nickname) {
              nextContact = { ...nextContact, name: nickname };
            }
            if (!options?.skipContactStateUpdate) {
              const pinnedState = pinnedContactStateRef.current.get(key);
              const discoveredState = discoveredConversationStates.get(key);
              nextContact = applyConversationPreferenceStateToContact(nextContact, pinnedState ?? discoveredState);
            }
            return nextContact;
          });
          return nextContacts;
        });
      }

      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const candidateAddresses = Array.from(
        new Set([
          ...contacts.map((contact) => contact.address),
          ...Array.from(discoveredContacts),
          ...Array.from(recentPeersByAccount.values()).flatMap((peers) => peers.map((peer) => peer.address))
        ])
      );
      const activeKey = isWalletAddress(activeContactAddress) ? activeContactAddress.toLowerCase() : undefined;
      const pageVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
      const unreadResolution = resolveDirectUnreadState({
        activeKey,
        candidateAddresses,
        globalReadTs: normalizeLastReadAllTs(lastReadAllTsRef.current),
        latestMessageTimeByContact: latestIncomingMessageTimeByContact,
        pageVisible,
        previousReadByContact: lastReadByContactRef.current,
        previousUnread: unreadMapRef.current,
        suppressedKeys: notificationSuppressedContactAddressSet,
        walletKey: requestedWalletKey
      });
      if (unreadResolution.readByContactChanged) {
        lastReadByContactRef.current = unreadResolution.nextReadByContact;
      }
      if (unreadResolution.unreadChanged) {
        unreadMapRef.current = unreadResolution.nextUnread;
        setUnreadMap(unreadResolution.nextUnread);
      }

      if (readStateFeaturesEnabled) {
        const knownBackupBlockNumber = lastStateBackupBlockRef.current[requestedWalletKey];
        const knownAutoBackupAttemptBlock = lastAutoBackupAttemptBlockRef.current[requestedWalletKey] ?? 0;
        const blocksSinceAutoBackupAttempt = latestBlock - knownAutoBackupAttemptBlock;
        const hasLocalStateSnapshot = normalizeLastReadAllTs(lastReadAllTsRef.current) > 0;
        const shouldAutoBackupForDistance =
          hasLocalStateSnapshot &&
          typeof knownBackupBlockNumber === 'number' &&
          latestBlock - knownBackupBlockNumber >= AUTO_STATE_BACKUP_BLOCK_DISTANCE &&
          blocksSinceAutoBackupAttempt >= AUTO_STATE_BACKUP_RETRY_BLOCKS;

        if (shouldAutoBackupForDistance) {
          lastAutoBackupAttemptBlockRef.current[requestedWalletKey] = latestBlock;
          backupLocalStateToSelf({ force: true, background: true }).catch(() => {});
        }
      }

      if (useActiveContactOnly && typeof options?.toBlock !== 'number') {
        lastActiveContactSyncedBlockRef.current[`${requestedWalletKey}:${activeContactAddress.toLowerCase()}`] =
          latestBlock;
      } else if ((options?.updateHead || !options?.contactsOnly) && typeof options?.toBlock !== 'number') {
        lastSyncedBlockRef.current[requestedWalletKey] = latestBlock;
      }

      setSessionOnboardInfo((previous) => {
        let next = previous;
        for (const { signer, cacheKey } of signerBundles) {
          const nextOnboardInfo = signer.getUserOnboardInfo();
          if (!nextOnboardInfo) {
            continue;
          }
          next = {
            ...next,
            [cacheKey]: mergeOnboardInfo(next[cacheKey], nextOnboardInfo)
          };
        }
        return next;
      });
    } catch (syncError) {
      try {
        console.error('[sync] ChatGC error', syncError);
      } catch {}
      if (!options?.background) {
        setError(syncError instanceof Error ? syncError.message : 'Failed to sync history.');
      }
    } finally {
      syncingHistoryRef.current = false;
      if (!options?.background) {
        setSyncingHistory(false);
      }

      const pendingOptions = pendingSyncOptionsRef.current;
      pendingSyncOptionsRef.current = null;
      if (pendingOptions) {
        syncConversationHistoryImplRef.current(pendingOptions).catch(() => {});
      }
    }
  };

  loadOlderMessagesForActiveContactImplRef.current = async () => {
    const {
      activeContact,
      currentWalletKeyRef,
      fetchOnChainNicknames,
      getMemoSigner,
      getMemoSignerForAccount,
      hasAesReady,
      messagesByContact,
      setContacts,
      setError,
      setLoadingOlderHistory,
      setMessagesByContact,
      setSessionOnboardInfo,
      walletAddress,
      readAccounts
    } = argsRef.current;

    const readableAccounts = resolveReadableDirectAccounts(walletAddress, hasAesReady, readAccounts);
    if (
      loadingOlderHistoryRef.current ||
      syncingHistoryRef.current ||
      !walletAddress ||
      !activeContact ||
      readableAccounts.length === 0
    ) {
      return;
    }

    const requestedWalletAddress = walletAddress.trim();
    const requestedWalletKey = requestedWalletAddress.toLowerCase();
    const contactAddress = activeContact.trim();
    if (!isWalletAddress(contactAddress)) {
      return;
    }

    const contactKey = contactAddress.toLowerCase();
    if (hasOlderHistoryByContactRef.current[contactKey] === false) {
      return;
    }

    try {
      loadingOlderHistoryRef.current = true;
      setLoadingOlderHistory(true);
      setError('');

      const cotiEthers = await loadCotiEthersModule();
      const readProvider = await loadCotiReadProvider(true);
      const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, readProvider);
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const entries: HistoryEntry[] = [];
      const discoveredNicknames = new Map<string, string>();
      const signerBundles: Array<{ account: WalletReadAccount; signer: Wallet | JsonRpcSigner; cacheKey: string }> = [];
      for (const account of readableAccounts) {
        try {
          const signerBundle = getMemoSignerForAccount
            ? await getMemoSignerForAccount(account)
            : await getMemoSigner();
          signerBundles.push({ account, ...signerBundle });
        } catch (signerError) {
          if (account.isActionAccount) {
            throw signerError;
          }
        }
      }

      for (const { account, signer, cacheKey } of signerBundles) {
        const accountAddress = account.address.trim();
        const accountKey = account.key || accountAddress.toLowerCase();
        const accountContactCacheKey = buildPerAccountContactKey(accountKey, contactKey);
        const count = await readConversationMessageCount(contract, accountAddress, contactAddress).catch(() => 0);
        const loadedConfirmedCount = (messagesByContact[contactKey] ?? []).filter(
          (message) =>
            !message.id.startsWith('local-') &&
            message.txHash?.startsWith('chatgc:') &&
            (message.accountAddress ?? requestedWalletAddress).trim().toLowerCase() === accountKey
        ).length;
        const currentOffset =
          oldestLoadedOffsetByContactRef.current[accountContactCacheKey] ?? Math.max(0, count - loadedConfirmedCount);
        if (count <= 0 || currentOffset <= 0) {
          hasOlderHistoryByContactRef.current[accountContactCacheKey] = false;
          continue;
        }

        const nextOffset = Math.max(0, currentOffset - CHAT_GC_THREAD_PAGE_SIZE);
        const limit = currentOffset - nextOffset;
        const ids = await readConversationMessageIds(contract, accountAddress, contactAddress, nextOffset, limit);
        oldestLoadedOffsetByContactRef.current[accountContactCacheKey] = nextOffset;
        hasOlderHistoryByContactRef.current[accountContactCacheKey] = nextOffset > 0;

        for (const messageId of ids) {
          const parsed = await parseMessageById(contract, messageId, accountAddress, signer, cacheKey, account);
          if (!parsed) {
            continue;
          }
          if (parsed.entry) {
            entries.push(parsed.entry);
          }
          if (parsed.contactName) {
            discoveredNicknames.set(parsed.contactAddress.toLowerCase(), parsed.contactName);
          }
        }
      }

      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      if (entries.length > 0) {
        setMessagesByContact((previous) =>
          mergeDirectHistoryEntries(previous, entries, requestedWalletAddress, {
            pruneOptimisticOutgoing: false
          })
        );
      }

      const onChainNicknames = await fetchOnChainNicknames([contactAddress]);
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      if (discoveredNicknames.size > 0 || onChainNicknames.get(contactKey)) {
        setContacts((previous) =>
          previous.map((contact) => {
            const nickname =
              discoveredNicknames.get(contact.address.toLowerCase()) ??
              onChainNicknames.get(contact.address.toLowerCase());
            if (!nickname || contact.name === nickname) {
              return contact;
            }
            return { ...contact, name: nickname };
          })
        );
      }

      setSessionOnboardInfo((previous) => {
        let next = previous;
        for (const { signer, cacheKey } of signerBundles) {
          const nextOnboardInfo = signer.getUserOnboardInfo();
          if (!nextOnboardInfo) {
            continue;
          }
          next = {
            ...next,
            [cacheKey]: mergeOnboardInfo(next[cacheKey], nextOnboardInfo)
          };
        }
        return next;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load older history.');
    } finally {
      loadingOlderHistoryRef.current = false;
      setLoadingOlderHistory(false);
    }
  };

  const { activeContact, activeGroupId, activeMessagesLength, hasAesReady, walletAddress, readAccounts } = args;
  const hasReadableDirectAccount = resolveReadableDirectAccounts(walletAddress, hasAesReady, readAccounts).length > 0;
  useEffect(() => {
    if (
      !activeContact ||
      activeGroupId !== null ||
      syncingHistoryRef.current ||
      loadingOlderHistoryRef.current ||
      !walletAddress ||
      !hasReadableDirectAccount
    ) {
      return;
    }

    const contactAddress = activeContact.trim();
    if (!isWalletAddress(contactAddress)) {
      return;
    }

    const contactKey = contactAddress.toLowerCase();
    if (autoPrefetchedRecentHistoryByContactRef.current[contactKey]) {
      return;
    }

    if (activeMessagesLength > 1) {
      return;
    }

    if (hasOlderHistoryByContactRef.current[contactKey] === false && activeMessagesLength > 0) {
      return;
    }

    autoPrefetchedRecentHistoryByContactRef.current[contactKey] = true;
    loadOlderMessagesForActiveContact().catch(() => {
      delete autoPrefetchedRecentHistoryByContactRef.current[contactKey];
    });
  }, [
    activeContact,
    activeGroupId,
    activeMessagesLength,
    hasReadableDirectAccount,
    loadOlderMessagesForActiveContact,
    walletAddress
  ]);

  return {
    isSyncingConversationHistoryRef: syncingHistoryRef,
    loadFullConversationHistory,
    loadOlderMessagesForActiveContact,
    resetConversationHistoryCaches,
    syncConversationHistory
  };
}
