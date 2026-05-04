import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import { resolveRecentPeersWithMeta } from '../lib/appLookup';
import {
  mergeDirectHistoryEntries,
  resolveDirectUnreadState
} from '../lib/directConversationSyncHelpers';
import {
  mergeDirectSyncOptions,
  resolveDirectSyncRange,
  resolveOlderDirectHistoryRange
} from '../lib/directSyncPlan';
import {
  applyConversationPreferenceStateToContact,
  AUTO_STATE_BACKUP_BLOCK_DISTANCE,
  AUTO_STATE_BACKUP_RETRY_BLOCKS,
  CHAT_CONTRACT_ABI,
  CHAT_CONTRACT_ADDRESS,
  debugLog,
  extractUserCiphertext,
  FAST_CONTACT_PREVIEW_BATCH_SIZE,
  FAST_CONTACT_PREVIEW_BLOCK_LOOKBACK,
  HISTORY_PAGINATION_BLOCK_WINDOW,
  INITIAL_SYNC_LOOKBACK_BLOCKS,
  isWalletAddress,
  loadCotiEthersModule,
  loadCotiReadProvider,
  mergeOnboardInfo,
  mergeUniqueContacts,
  normalizeConversationPreferenceState,
  normalizeLastReadAllTs,
  parseChatMessagePayload,
  parseReadCursorText,
  parseStateBackupText,
  type BackupLocalStateOptions,
  type ChatMessage,
  type Contact,
  type ConversationBlockRange,
  type ConversationLog,
  type ConversationPreferenceState,
  type HistoryEntry,
  type StateBackupPayload,
  type SyncConversationOptions
} from '../lib/appShared';

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
};

export default function useDirectConversationSync(args: UseDirectConversationSyncArgs) {
  const argsRef = useRef(args);
  argsRef.current = args;

  const syncingHistoryRef = useRef(false);
  const pendingSyncOptionsRef = useRef<SyncConversationOptions | null>(null);
  const lastSyncedBlockRef = useRef<Record<string, number>>({});
  const lastActiveContactSyncedBlockRef = useRef<Record<string, number>>({});
  const oldestLoadedBlockByContactRef = useRef<Record<string, number>>({});
  const hasOlderHistoryByContactRef = useRef<Record<string, boolean>>({});
  const conversationRangeByContactRef = useRef<Record<string, ConversationBlockRange>>({});
  const loadingOlderHistoryRef = useRef(false);
  const autoPrefetchedRecentHistoryByContactRef = useRef<Record<string, boolean>>({});
  const syncConversationHistoryImplRef = useRef<(options?: SyncConversationOptions) => Promise<void>>(async () => {});
  const loadOlderMessagesForActiveContactImplRef = useRef<() => Promise<void>>(async () => {});

  const resetConversationHistoryCaches = useCallback(() => {
    lastSyncedBlockRef.current = {};
    lastActiveContactSyncedBlockRef.current = {};
    oldestLoadedBlockByContactRef.current = {};
    hasOlderHistoryByContactRef.current = {};
    conversationRangeByContactRef.current = {};
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

  syncConversationHistoryImplRef.current = async (options?: SyncConversationOptions) => {
    const {
      applyStateBackupPayload,
      backupLocalStateToSelf,
      chainId,
      contacts,
      currentWalletKeyRef,
      decryptMemoPlaintextWithRecovery,
      fetchOnChainNicknames,
      getMemoSigner,
      hasAesReady,
      lastAutoBackupAttemptBlockRef,
      lastReadAllTsRef,
      lastReadByContactRef,
      lastStateBackupBlockRef,
      messagesByContact,
      notificationSuppressedContactAddressSet,
      parseEncryptedChatMessagePayload,
      pinnedContactStateRef,
      readStateFeaturesEnabled,
      resolveBlockTimestampMap,
      setContacts,
      setError,
      setMessagesByContact,
      setSessionOnboardInfo,
      setSyncingHistory,
      setUnreadMap,
      unreadMapRef,
      walletAddress
    } = argsRef.current;

    setError('');
    debugLog('[sync] start', { walletAddress, options, hasAesReady, chainId });

    const requestedWalletAddress = walletAddress.trim();
    const requestedWalletKey = requestedWalletAddress.toLowerCase();
    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress)) {
      return;
    }

    if (syncingHistoryRef.current) {
      pendingSyncOptionsRef.current = mergeDirectSyncOptions(options, pendingSyncOptionsRef.current);
      return;
    }

    try {
      const runInBackground = Boolean(options?.background);
      const shouldLoadContactPreviews = Boolean(options?.contactsOnly && options?.previewPerContact);
      syncingHistoryRef.current = true;
      if (!runInBackground) {
        setSyncingHistory(true);
      }
      const { signer, cacheKey } = await getMemoSigner();
      const cotiEthers = await loadCotiEthersModule();
      const readProvider = await loadCotiReadProvider(true);
      const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, readProvider);
      const latestBlock = await readProvider.getBlockNumber();
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const walletKey = requestedWalletKey;
      const activeContactAddress = argsRef.current.activeContact?.trim() ?? '';
      const useActiveContactOnly =
        Boolean(options?.activeContactOnly) &&
        !options?.contactsOnly &&
        !options?.deep &&
        isWalletAddress(activeContactAddress);
      const activeContactKey = activeContactAddress.toLowerCase();
      const activeContactSyncKey = useActiveContactOnly ? `${walletKey}:${activeContactKey}` : '';
      const activeContactSyncedBlock = useActiveContactOnly
        ? lastActiveContactSyncedBlockRef.current[activeContactSyncKey]
        : undefined;
      const globalSyncedBlock = lastSyncedBlockRef.current[walletKey];
      const lastSyncedBlockForRange =
        useActiveContactOnly &&
        typeof activeContactSyncedBlock === 'number' &&
        typeof globalSyncedBlock === 'number'
          ? Math.max(activeContactSyncedBlock, globalSyncedBlock)
          : useActiveContactOnly
            ? activeContactSyncedBlock ?? globalSyncedBlock
            : globalSyncedBlock;
      const syncRange = resolveDirectSyncRange({
        initialLookbackBlocks: INITIAL_SYNC_LOOKBACK_BLOCKS,
        latestBlock,
        lastSyncedBlock: lastSyncedBlockForRange,
        options
      });
      if (!syncRange.shouldQuery) {
        return;
      }
      const { fromBlock, toBlock } = syncRange;

      const discoveredContacts = new Set<string>();
      const discoveredNicknames = new Map<string, string>();
      const discoveredConversationStates = new Map<
        string,
        { state: ConversationPreferenceState; blockNumber: number; logIndex: number }
      >();
      const latestIncomingMessageTimeByContact = new Map<string, number>();
      const entries: HistoryEntry[] = [];
      const previewByContact = new Map<string, HistoryEntry>();
      let latestStateBackup:
        | {
            payload: StateBackupPayload;
            blockNumber: number;
            logIndex: number;
          }
        | null = null;

      const trackDiscoveredConversationState = (
        address: string,
        state: ConversationPreferenceState | undefined,
        blockNumber: number,
        logIndex: number
      ) => {
        const normalizedAddress = address.trim().toLowerCase();
        if (!isWalletAddress(normalizedAddress)) {
          return;
        }

        const normalizedState = normalizeConversationPreferenceState(state);
        if (!normalizedState) {
          return;
        }

        const existingState = discoveredConversationStates.get(normalizedAddress);
        const shouldReplace =
          !existingState ||
          blockNumber > existingState.blockNumber ||
          (blockNumber === existingState.blockNumber && logIndex > existingState.logIndex);
        if (shouldReplace) {
          discoveredConversationStates.set(normalizedAddress, {
            state: normalizedState,
            blockNumber,
            logIndex
          });
        }
      };

      const recentPeersWithMeta = useActiveContactOnly
        ? []
        : await resolveRecentPeersWithMeta(contract, requestedWalletAddress);
      if (useActiveContactOnly) {
        discoveredContacts.add(activeContactAddress);
      } else {
        for (const peer of recentPeersWithMeta) {
          discoveredContacts.add(peer.address);
        }
      }

      let incomingLogs: ConversationLog[] = [];
      let outgoingLogs: ConversationLog[] = [];
      const useFastPreviewPath = shouldLoadContactPreviews && recentPeersWithMeta.length > 0;

      if (useActiveContactOnly) {
        const incomingFilter = contract.filters.MessageSubmitted(requestedWalletAddress, activeContactAddress);
        const outgoingFilter = contract.filters.MessageSubmitted(activeContactAddress, requestedWalletAddress);
        const [incomingLogsRaw, outgoingLogsRaw] = await Promise.all([
          contract.queryFilter(incomingFilter, fromBlock, toBlock),
          contract.queryFilter(outgoingFilter, fromBlock, toBlock)
        ]);
        incomingLogs = incomingLogsRaw as ConversationLog[];
        outgoingLogs = outgoingLogsRaw as ConversationLog[];
      } else if (useFastPreviewPath) {
        const previewCandidates = recentPeersWithMeta.filter(
          (peer) => peer.lastBlock > 0 && peer.lastBlock <= toBlock
        );

        for (
          let batchStart = 0;
          batchStart < previewCandidates.length;
          batchStart += FAST_CONTACT_PREVIEW_BATCH_SIZE
        ) {
          const batch = previewCandidates.slice(batchStart, batchStart + FAST_CONTACT_PREVIEW_BATCH_SIZE);
          const batchResults = await Promise.all(
            batch.map(async (peer): Promise<{ incoming: ConversationLog[]; outgoing: ConversationLog[] }> => {
              const headBlock = peer.lastBlock;
              const incomingFilter = contract.filters.MessageSubmitted(requestedWalletAddress, peer.address);
              const outgoingFilter = contract.filters.MessageSubmitted(peer.address, requestedWalletAddress);

              try {
                let [incomingPreviewLogs, outgoingPreviewLogs] = await Promise.all([
                  contract.queryFilter(incomingFilter, headBlock, headBlock),
                  contract.queryFilter(outgoingFilter, headBlock, headBlock)
                ]);

                if (incomingPreviewLogs.length === 0 && outgoingPreviewLogs.length === 0 && headBlock > 0) {
                  const fallbackStart = Math.max(0, headBlock - FAST_CONTACT_PREVIEW_BLOCK_LOOKBACK);
                  [incomingPreviewLogs, outgoingPreviewLogs] = await Promise.all([
                    contract.queryFilter(incomingFilter, fallbackStart, headBlock),
                    contract.queryFilter(outgoingFilter, fallbackStart, headBlock)
                  ]);
                }

                return {
                  incoming: incomingPreviewLogs as ConversationLog[],
                  outgoing: outgoingPreviewLogs as ConversationLog[]
                };
              } catch {
                return { incoming: [], outgoing: [] };
              }
            })
          );

          if (currentWalletKeyRef.current !== requestedWalletKey) {
            return;
          }

          for (const result of batchResults) {
            incomingLogs.push(...result.incoming);
            outgoingLogs.push(...result.outgoing);
          }
        }
      } else {
        const incomingFilter = contract.filters.MessageSubmitted(requestedWalletAddress, null);
        const outgoingFilter = contract.filters.MessageSubmitted(null, requestedWalletAddress);
        const [incomingLogsRaw, outgoingLogsRaw] = await Promise.all([
          contract.queryFilter(incomingFilter, fromBlock, toBlock),
          contract.queryFilter(outgoingFilter, fromBlock, toBlock)
        ]);
        incomingLogs = incomingLogsRaw as ConversationLog[];
        outgoingLogs = outgoingLogsRaw as ConversationLog[];
      }
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const blockNumbers = new Set<number>();
      for (const log of incomingLogs) {
        blockNumbers.add(log.blockNumber);
      }
      for (const log of outgoingLogs) {
        blockNumbers.add(log.blockNumber);
      }

      const blockTimestampMap = await resolveBlockTimestampMap(readProvider, blockNumbers);

      const updateLatestIncomingMessageTime = (address: string, blockNumber: number): void => {
        const normalizedAddress = address.trim().toLowerCase();
        if (!isWalletAddress(normalizedAddress)) {
          return;
        }

        const blockTimestamp = blockTimestampMap.get(blockNumber);
        if (typeof blockTimestamp !== 'number' || blockTimestamp <= 0) {
          return;
        }

        const existingObserved = latestIncomingMessageTimeByContact.get(normalizedAddress) ?? 0;
        if (blockTimestamp > existingObserved) {
          latestIncomingMessageTimeByContact.set(normalizedAddress, blockTimestamp);
        }
      };

      for (const log of incomingLogs) {
        const logArgs = (log as { args?: Record<string, unknown> }).args;
        const from = String(logArgs?.from ?? '');
        if (!isWalletAddress(from)) {
          continue;
        }

        const isSelfIncoming = from.toLowerCase() === walletKey;
        if (isSelfIncoming) {
          const selfCiphertext = extractUserCiphertext(logArgs?.messageForRecipient);
          let isSystemSelfMessage = false;
          if (selfCiphertext && selfCiphertext.value.length > 0) {
            try {
              const plain = await decryptMemoPlaintextWithRecovery(signer, cacheKey, selfCiphertext);
              const backupPayload = parseStateBackupText(plain);
              if (backupPayload) {
                isSystemSelfMessage = true;
                if (
                  !latestStateBackup ||
                  log.blockNumber > latestStateBackup.blockNumber ||
                  (log.blockNumber === latestStateBackup.blockNumber && log.index > latestStateBackup.logIndex)
                ) {
                  latestStateBackup = {
                    payload: backupPayload,
                    blockNumber: log.blockNumber,
                    logIndex: log.index
                  };
                  debugLog('[restore] found state backup', {
                    address: walletKey,
                    nickname: backupPayload.nickname,
                    tx: log.transactionHash,
                    block: log.blockNumber,
                    index: log.index
                  });
                }
              }
              if (parseReadCursorText(plain)) {
                isSystemSelfMessage = true;
              }
            } catch {
            }
          }
          if (isSystemSelfMessage) {
            continue;
          }
        }

        discoveredContacts.add(from);
        updateLatestIncomingMessageTime(from, log.blockNumber);

        if (options?.contactsOnly && !shouldLoadContactPreviews) {
          continue;
        }

        if (shouldLoadContactPreviews) {
          const contactKey = from.toLowerCase();
          const existingPreview = previewByContact.get(contactKey);
          const isNewerPreview =
            !existingPreview ||
            log.blockNumber > existingPreview.blockNumber ||
            (log.blockNumber === existingPreview.blockNumber && log.index > existingPreview.logIndex);

          if (!isNewerPreview) {
            continue;
          }

          const userCiphertext = extractUserCiphertext(logArgs?.messageForRecipient);
          let messageText = '(Unable to decrypt message)';
          let replyToMessageId: string | undefined;
          let replyToText: string | undefined;
          let replyToTxHash: string | undefined;
          let replyToBlockNumber: number | undefined;
          let replyToLogIndex: number | undefined;
          let reactionToTxHash: string | undefined;
          let reactionToBlockNumber: number | undefined;
          let reactionToLogIndex: number | undefined;
          let reactionEmoji: string | undefined;
          if (userCiphertext && userCiphertext.value.length > 0) {
            try {
              const parsedMessage = await parseEncryptedChatMessagePayload(signer, cacheKey, userCiphertext);
              messageText = parsedMessage.cleanText;
              replyToMessageId = parsedMessage.replyToMessageId;
              replyToText = parsedMessage.replyToText;
              replyToTxHash = parsedMessage.replyToTxHash;
              replyToBlockNumber = parsedMessage.replyToBlockNumber;
              replyToLogIndex = parsedMessage.replyToLogIndex;
              reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
              reactionToBlockNumber = parsedMessage.embeddedReaction?.targetBlockNumber;
              reactionToLogIndex = parsedMessage.embeddedReaction?.targetLogIndex;
              reactionEmoji = parsedMessage.embeddedReaction?.emoji;
              if (
                messageText.trim().length === 0 &&
                (parsedMessage.embeddedContactName || parsedMessage.embeddedConversationState)
              ) {
                continue;
              }
              if (parsedMessage.embeddedNickname) {
                discoveredNicknames.set(contactKey, parsedMessage.embeddedNickname);
                debugLog('[sync] discovered nickname', {
                  address: contactKey,
                  nickname: parsedMessage.embeddedNickname,
                  tx: log.transactionHash,
                  block: log.blockNumber,
                  index: log.index
                });
              }
            } catch {
              messageText = '(Unable to decrypt message)';
            }
          }

          previewByContact.set(contactKey, {
            id: `${log.transactionHash}-${log.index}-in`,
            contact: from,
            direction: 'incoming',
            text: messageText,
            replyToMessageId,
            replyToText,
            replyToTxHash,
            replyToBlockNumber,
            replyToLogIndex,
            reactionToTxHash,
            reactionToBlockNumber,
            reactionToLogIndex,
            reactionEmoji,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.index,
            timestamp: blockTimestampMap.get(log.blockNumber)
          });
          continue;
        }

        const userCiphertext = extractUserCiphertext(logArgs?.messageForRecipient);
        let messageText = '(Unable to decrypt message)';
        let replyToMessageId: string | undefined;
        let replyToText: string | undefined;
        let replyToTxHash: string | undefined;
        let replyToBlockNumber: number | undefined;
        let replyToLogIndex: number | undefined;
        let reactionToTxHash: string | undefined;
        let reactionToBlockNumber: number | undefined;
        let reactionToLogIndex: number | undefined;
        let reactionEmoji: string | undefined;
        if (userCiphertext && userCiphertext.value.length > 0) {
          try {
            const parsedMessage = await parseEncryptedChatMessagePayload(signer, cacheKey, userCiphertext);
            messageText = parsedMessage.cleanText;
            replyToMessageId = parsedMessage.replyToMessageId;
            replyToText = parsedMessage.replyToText;
            replyToTxHash = parsedMessage.replyToTxHash;
            replyToBlockNumber = parsedMessage.replyToBlockNumber;
            replyToLogIndex = parsedMessage.replyToLogIndex;
            reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
            reactionToBlockNumber = parsedMessage.embeddedReaction?.targetBlockNumber;
            reactionToLogIndex = parsedMessage.embeddedReaction?.targetLogIndex;
            reactionEmoji = parsedMessage.embeddedReaction?.emoji;
            if (
              messageText.trim().length === 0 &&
              (parsedMessage.embeddedContactName || parsedMessage.embeddedConversationState)
            ) {
              continue;
            }
            if (parsedMessage.embeddedNickname) {
              discoveredNicknames.set(from.toLowerCase(), parsedMessage.embeddedNickname);
              debugLog('[sync] discovered nickname', {
                address: from.toLowerCase(),
                nickname: parsedMessage.embeddedNickname,
                tx: log.transactionHash,
                block: log.blockNumber,
                index: log.index
              });
            }
          } catch {
            messageText = '(Unable to decrypt message)';
          }
        }

        entries.push({
          id: `${log.transactionHash}-${log.index}-in`,
          contact: from,
          direction: 'incoming',
          text: messageText,
          replyToMessageId,
          replyToText,
          replyToTxHash,
          replyToBlockNumber,
          replyToLogIndex,
          reactionToTxHash,
          reactionToBlockNumber,
          reactionToLogIndex,
          reactionEmoji,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          timestamp: blockTimestampMap.get(log.blockNumber)
        });
      }

      for (const log of outgoingLogs) {
        const logArgs = (log as { args?: Record<string, unknown> }).args;
        const recipient = String(logArgs?.recipient ?? '');
        if (!isWalletAddress(recipient)) {
          continue;
        }

        if (recipient.toLowerCase() === walletKey) {
          const selfCiphertext = extractUserCiphertext(logArgs?.messageForSender);
          if (selfCiphertext && selfCiphertext.value.length > 0) {
            try {
              const plain = await decryptMemoPlaintextWithRecovery(signer, cacheKey, selfCiphertext);
              const backupPayload = parseStateBackupText(plain);
              if (backupPayload) {
                if (
                  !latestStateBackup ||
                  log.blockNumber > latestStateBackup.blockNumber ||
                  (log.blockNumber === latestStateBackup.blockNumber && log.index > latestStateBackup.logIndex)
                ) {
                  latestStateBackup = {
                    payload: backupPayload,
                    blockNumber: log.blockNumber,
                    logIndex: log.index
                  };
                }
              }
              if (parseReadCursorText(plain)) {
                continue;
              }
            } catch {
            }
          }
          continue;
        }

        discoveredContacts.add(recipient);

        if (options?.contactsOnly && !shouldLoadContactPreviews) {
          continue;
        }

        if (shouldLoadContactPreviews) {
          const contactKey = recipient.toLowerCase();
          const existingPreview = previewByContact.get(contactKey);
          const isNewerPreview =
            !existingPreview ||
            log.blockNumber > existingPreview.blockNumber ||
            (log.blockNumber === existingPreview.blockNumber && log.index > existingPreview.logIndex);

          if (!isNewerPreview) {
            continue;
          }

          const userCiphertext = extractUserCiphertext(logArgs?.messageForSender);
          let messageText = '(Unable to decrypt message)';
          let replyToMessageId: string | undefined;
          let replyToText: string | undefined;
          let replyToTxHash: string | undefined;
          let replyToBlockNumber: number | undefined;
          let replyToLogIndex: number | undefined;
          let reactionToTxHash: string | undefined;
          let reactionToBlockNumber: number | undefined;
          let reactionToLogIndex: number | undefined;
          let reactionEmoji: string | undefined;
          if (userCiphertext && userCiphertext.value.length > 0) {
            try {
              const parsedMessage = await parseEncryptedChatMessagePayload(signer, cacheKey, userCiphertext);
              messageText = parsedMessage.cleanText;
              replyToMessageId = parsedMessage.replyToMessageId;
              replyToText = parsedMessage.replyToText;
              replyToTxHash = parsedMessage.replyToTxHash;
              replyToBlockNumber = parsedMessage.replyToBlockNumber;
              replyToLogIndex = parsedMessage.replyToLogIndex;
              reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
              reactionToBlockNumber = parsedMessage.embeddedReaction?.targetBlockNumber;
              reactionToLogIndex = parsedMessage.embeddedReaction?.targetLogIndex;
              reactionEmoji = parsedMessage.embeddedReaction?.emoji;
              if (parsedMessage.embeddedContactName) {
                discoveredNicknames.set(contactKey, parsedMessage.embeddedContactName);
              }
              trackDiscoveredConversationState(
                contactKey,
                parsedMessage.embeddedConversationState,
                log.blockNumber,
                log.index
              );
              if (
                messageText.trim().length === 0 &&
                (parsedMessage.embeddedContactName || parsedMessage.embeddedConversationState)
              ) {
                continue;
              }
            } catch {
              messageText = '(Unable to decrypt message)';
            }
          }

          previewByContact.set(contactKey, {
            id: `${log.transactionHash}-${log.index}-out`,
            contact: recipient,
            direction: 'outgoing',
            text: messageText,
            replyToMessageId,
            replyToText,
            replyToTxHash,
            replyToBlockNumber,
            replyToLogIndex,
            reactionToTxHash,
            reactionToBlockNumber,
            reactionToLogIndex,
            reactionEmoji,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.index,
            timestamp: blockTimestampMap.get(log.blockNumber)
          });
          continue;
        }

        const userCiphertext = extractUserCiphertext(logArgs?.messageForSender);
        let messageText = '(Unable to decrypt message)';
        let replyToMessageId: string | undefined;
        let replyToText: string | undefined;
        let replyToTxHash: string | undefined;
        let replyToBlockNumber: number | undefined;
        let replyToLogIndex: number | undefined;
        let reactionToTxHash: string | undefined;
        let reactionToBlockNumber: number | undefined;
        let reactionToLogIndex: number | undefined;
        let reactionEmoji: string | undefined;
        if (userCiphertext && userCiphertext.value.length > 0) {
          try {
            const parsedMessage = await parseEncryptedChatMessagePayload(signer, cacheKey, userCiphertext);
            messageText = parsedMessage.cleanText;
            replyToMessageId = parsedMessage.replyToMessageId;
            replyToText = parsedMessage.replyToText;
            replyToTxHash = parsedMessage.replyToTxHash;
            replyToBlockNumber = parsedMessage.replyToBlockNumber;
            replyToLogIndex = parsedMessage.replyToLogIndex;
            reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
            reactionToBlockNumber = parsedMessage.embeddedReaction?.targetBlockNumber;
            reactionToLogIndex = parsedMessage.embeddedReaction?.targetLogIndex;
            reactionEmoji = parsedMessage.embeddedReaction?.emoji;
            if (parsedMessage.embeddedContactName) {
              discoveredNicknames.set(recipient.toLowerCase(), parsedMessage.embeddedContactName);
            }
            trackDiscoveredConversationState(
              recipient.toLowerCase(),
              parsedMessage.embeddedConversationState,
              log.blockNumber,
              log.index
            );
            if (
              messageText.trim().length === 0 &&
              (parsedMessage.embeddedContactName || parsedMessage.embeddedConversationState)
            ) {
              continue;
            }
          } catch {
            messageText = '(Unable to decrypt message)';
          }
        }

        entries.push({
          id: `${log.transactionHash}-${log.index}-out`,
          contact: recipient,
          direction: 'outgoing',
          text: messageText,
          replyToMessageId,
          replyToText,
          replyToTxHash,
          replyToBlockNumber,
          replyToLogIndex,
          reactionToTxHash,
          reactionToBlockNumber,
          reactionToLogIndex,
          reactionEmoji,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          timestamp: blockTimestampMap.get(log.blockNumber)
        });
      }

      if (shouldLoadContactPreviews) {
        entries.push(...previewByContact.values());
      }
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      if (!options?.contactsOnly || shouldLoadContactPreviews) {
        entries.sort((left, right) => {
          if (left.blockNumber !== right.blockNumber) {
            return left.blockNumber - right.blockNumber;
          }
          return left.logIndex - right.logIndex;
        });

        const earliestBlockByContact = new Map<string, number>();
        for (const entry of entries) {
          const key = entry.contact.toLowerCase();
          const existingEarliest = earliestBlockByContact.get(key);
          if (typeof existingEarliest !== 'number' || entry.blockNumber < existingEarliest) {
            earliestBlockByContact.set(key, entry.blockNumber);
          }
        }

        for (const [contactKey, earliestBlock] of earliestBlockByContact.entries()) {
          const knownEarliest = oldestLoadedBlockByContactRef.current[contactKey];
          if (typeof knownEarliest !== 'number' || earliestBlock < knownEarliest) {
            oldestLoadedBlockByContactRef.current[contactKey] = earliestBlock;
          }
          const knownRange = conversationRangeByContactRef.current[contactKey];
          hasOlderHistoryByContactRef.current[contactKey] =
            typeof knownRange?.firstBlock === 'number' ? earliestBlock > knownRange.firstBlock : true;
        }

        setMessagesByContact((previous) => mergeDirectHistoryEntries(previous, entries, requestedWalletAddress));
      }
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const nicknameLookupAddresses = Array.from(
        new Set([...Array.from(discoveredContacts), ...contacts.map((contact) => contact.address)])
      );
      const onChainNicknames = await fetchOnChainNicknames(nicknameLookupAddresses);
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      setContacts((previous) => {
        const mergedContacts = mergeUniqueContacts(previous, Array.from(discoveredContacts));

        return mergedContacts.map((contact) => {
          const key = contact.address.toLowerCase();
          const nickname = discoveredNicknames.get(key) ?? onChainNicknames.get(key);
          const discoveredConversationState = discoveredConversationStates.get(key)?.state;

          let nextContact = contact;
          if (nickname && contact.name !== nickname) {
            nextContact = { ...nextContact, name: nickname };
          }

          if (discoveredConversationState && !options?.skipContactStateUpdate) {
            nextContact = applyConversationPreferenceStateToContact(
              nextContact,
              discoveredConversationState
            );
          }
          const pinned = pinnedContactStateRef.current.get(key);
          if (pinned) {
            nextContact = applyConversationPreferenceStateToContact(nextContact, pinned);
          }
          return nextContact;
        });
      });
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      if (latestStateBackup) {
        applyStateBackupPayload(
          walletKey,
          latestStateBackup.payload,
          latestStateBackup.blockNumber
        );
      }

      const unreadCandidateAddresses = Array.from(
        new Set([...Array.from(discoveredContacts), ...contacts.map((contact) => contact.address)])
      )
        .map((address) => address.trim().toLowerCase())
        .filter((address) => isWalletAddress(address) && address !== walletKey);

      if (!readStateFeaturesEnabled) {
        if (Object.keys(unreadMapRef.current || {}).length > 0) {
          unreadMapRef.current = {};
          setUnreadMap({});
        }
      } else if (unreadCandidateAddresses.length > 0) {
        const latestMessageTimeByContact = new Map<string, number>();
        for (const address of unreadCandidateAddresses) {
          const observed = latestIncomingMessageTimeByContact.get(address) ?? 0;
          const localMessages = messagesByContact[address] ?? [];
          let latestIncomingFromLocal = 0;
          for (const message of localMessages) {
            if (message.direction !== 'incoming' || typeof message.timestamp !== 'number') {
              continue;
            }
            const ts = Number(message.timestamp);
            if (ts > latestIncomingFromLocal) {
              latestIncomingFromLocal = ts;
            }
          }
          latestMessageTimeByContact.set(address, Math.max(observed, latestIncomingFromLocal));
        }

        const activeKey = argsRef.current.activeContact?.toLowerCase();
        const pageVisible =
          typeof document !== 'undefined' &&
          !document.hidden &&
          (typeof document.hasFocus === 'function' ? document.hasFocus() : true);
        const unreadState = resolveDirectUnreadState({
          activeKey,
          candidateAddresses: unreadCandidateAddresses,
          globalReadTs: lastReadAllTsRef.current,
          latestMessageTimeByContact,
          pageVisible,
          previousReadByContact: lastReadByContactRef.current,
          previousUnread: unreadMapRef.current || {},
          suppressedKeys: notificationSuppressedContactAddressSet,
          walletKey
        });

        if (unreadState.unreadChanged) {
          unreadMapRef.current = unreadState.nextUnread;
          setUnreadMap(unreadState.nextUnread);
        }

        if (unreadState.readByContactChanged) {
          lastReadByContactRef.current = unreadState.nextReadByContact;
        }
      }

      const knownBackupBlockNumber =
        latestStateBackup?.blockNumber ?? lastStateBackupBlockRef.current[walletKey];
      const lastAutoBackupAttemptBlock =
        lastAutoBackupAttemptBlockRef.current[walletKey] ?? -AUTO_STATE_BACKUP_RETRY_BLOCKS;
      const blocksSinceAutoBackupAttempt = latestBlock - lastAutoBackupAttemptBlock;
      const hasLocalStateSnapshot =
        normalizeLastReadAllTs(lastReadAllTsRef.current) > 0;
      const shouldAutoBackupForDistance =
        hasLocalStateSnapshot &&
        typeof knownBackupBlockNumber === 'number' &&
        latestBlock - knownBackupBlockNumber >= AUTO_STATE_BACKUP_BLOCK_DISTANCE &&
        blocksSinceAutoBackupAttempt >= AUTO_STATE_BACKUP_RETRY_BLOCKS;

      if (shouldAutoBackupForDistance) {
        lastAutoBackupAttemptBlockRef.current[walletKey] = latestBlock;
        backupLocalStateToSelf({ force: true, background: true }).catch(() => {});
      }

      if (useActiveContactOnly && activeContactSyncKey && typeof options?.toBlock !== 'number') {
        lastActiveContactSyncedBlockRef.current[activeContactSyncKey] = latestBlock;
      } else if ((options?.updateHead || !options?.contactsOnly) && typeof options?.toBlock !== 'number') {
        lastSyncedBlockRef.current[walletKey] = latestBlock;
      }
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

    } catch (syncError) {
      try {
        console.error('[sync] error', syncError);
      } catch {}
      if (!options?.background) {
        const message = syncError instanceof Error ? syncError.message : 'Failed to sync history.';
        setError(message);
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
      decryptMemoPlaintextWithRecovery,
      fetchOnChainNicknames,
      getMemoSigner,
      hasAesReady,
      messagesByContact,
      resolveBlockTimestampMap,
      resolveConversationBlockRange,
      setContacts,
      setError,
      setLoadingOlderHistory,
      setMessagesByContact,
      setSessionOnboardInfo,
      walletAddress
    } = argsRef.current;

    if (
      loadingOlderHistoryRef.current ||
      syncingHistoryRef.current ||
      !walletAddress ||
      !activeContact ||
      !hasAesReady
    ) {
      return;
    }

    const requestedWalletAddress = walletAddress.trim();
    const requestedWalletKey = requestedWalletAddress.toLowerCase();
    const walletKey = requestedWalletKey;
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

      const { signer, cacheKey } = await getMemoSigner();
      const cotiEthers = await loadCotiEthersModule();
      const readProvider = await loadCotiReadProvider(true);
      const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, readProvider);
      const latestBlock = await readProvider.getBlockNumber();
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }
      const cachedConversationRange = conversationRangeByContactRef.current[contactKey];
      const resolvedConversationRange =
        cachedConversationRange ??
        (await resolveConversationBlockRange(contract, requestedWalletAddress, contactAddress));
      if (!resolvedConversationRange || resolvedConversationRange.lastBlock <= 0) {
        hasOlderHistoryByContactRef.current[contactKey] = false;
        return;
      }
      conversationRangeByContactRef.current[contactKey] = resolvedConversationRange;
      const conversationFirstBlock = Math.max(0, resolvedConversationRange.firstBlock);
      const cappedConversationLastBlock = Math.min(latestBlock, resolvedConversationRange.lastBlock);
      if (cappedConversationLastBlock < conversationFirstBlock) {
        hasOlderHistoryByContactRef.current[contactKey] = false;
        return;
      }

      const historyRange = resolveOlderDirectHistoryRange({
        conversationFirstBlock: resolvedConversationRange.firstBlock,
        conversationLastBlock: resolvedConversationRange.lastBlock,
        historyWindowBlocks: HISTORY_PAGINATION_BLOCK_WINDOW,
        knownEarliestBlock: oldestLoadedBlockByContactRef.current[contactKey],
        knownMessages: messagesByContact[contactKey] ?? [],
        latestBlock
      });
      if (!historyRange.shouldQuery) {
        hasOlderHistoryByContactRef.current[contactKey] = false;
        return;
      }

      const { fromBlock, toBlock } = historyRange;

      const incomingFilter = contract.filters.MessageSubmitted(requestedWalletAddress, contactAddress);
      const outgoingFilter = contract.filters.MessageSubmitted(contactAddress, requestedWalletAddress);
      const [incomingLogs, outgoingLogs] = await Promise.all([
        contract.queryFilter(incomingFilter, fromBlock, toBlock),
        contract.queryFilter(outgoingFilter, fromBlock, toBlock)
      ]);
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      oldestLoadedBlockByContactRef.current[contactKey] = fromBlock;
      if (historyRange.hasReachedStart) {
        hasOlderHistoryByContactRef.current[contactKey] = false;
      }

      const blockNumbers = new Set<number>();
      for (const log of incomingLogs) {
        blockNumbers.add(log.blockNumber);
      }
      for (const log of outgoingLogs) {
        blockNumbers.add(log.blockNumber);
      }

      const blockTimestampMap = await resolveBlockTimestampMap(readProvider, blockNumbers);
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const entries: HistoryEntry[] = [];
      const discoveredNicknames = new Map<string, string>();

      for (const log of incomingLogs) {
        const logArgs = (log as { args?: Record<string, unknown> }).args;
        const from = String(logArgs?.from ?? '');
        if (!isWalletAddress(from) || from.toLowerCase() !== contactKey) {
          continue;
        }

        const userCiphertext = extractUserCiphertext(logArgs?.messageForRecipient);
        let messageText = '(Unable to decrypt message)';
        let replyToMessageId: string | undefined;
        let replyToText: string | undefined;
        let replyToTxHash: string | undefined;
        let replyToBlockNumber: number | undefined;
        let replyToLogIndex: number | undefined;
        let reactionToTxHash: string | undefined;
        let reactionToBlockNumber: number | undefined;
        let reactionToLogIndex: number | undefined;
        let reactionEmoji: string | undefined;

        if (userCiphertext && userCiphertext.value.length > 0) {
          try {
            const plain = await decryptMemoPlaintextWithRecovery(signer, cacheKey, userCiphertext);
            if (from.toLowerCase() === walletKey) {
              const backupPayload = parseStateBackupText(plain);
              if (backupPayload) {
                continue;
              }
            }

            const parsedMessage = parseChatMessagePayload(plain);
            messageText = parsedMessage.cleanText;
            replyToMessageId = parsedMessage.replyToMessageId;
            replyToText = parsedMessage.replyToText;
            replyToTxHash = parsedMessage.replyToTxHash;
            replyToBlockNumber = parsedMessage.replyToBlockNumber;
            replyToLogIndex = parsedMessage.replyToLogIndex;
            reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
            reactionToBlockNumber = parsedMessage.embeddedReaction?.targetBlockNumber;
            reactionToLogIndex = parsedMessage.embeddedReaction?.targetLogIndex;
            reactionEmoji = parsedMessage.embeddedReaction?.emoji;
            if (
              messageText.trim().length === 0 &&
              (parsedMessage.embeddedContactName || parsedMessage.embeddedConversationState)
            ) {
              continue;
            }
            if (parsedMessage.embeddedNickname) {
              discoveredNicknames.set(from.toLowerCase(), parsedMessage.embeddedNickname);
            }
          } catch {
            messageText = '(Unable to decrypt message)';
          }
        }

        entries.push({
          id: `${log.transactionHash}-${log.index}-in`,
          contact: from,
          direction: 'incoming',
          text: messageText,
          replyToMessageId,
          replyToText,
          replyToTxHash,
          replyToBlockNumber,
          replyToLogIndex,
          reactionToTxHash,
          reactionToBlockNumber,
          reactionToLogIndex,
          reactionEmoji,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          timestamp: blockTimestampMap.get(log.blockNumber)
        });
      }

      for (const log of outgoingLogs) {
        const logArgs = (log as { args?: Record<string, unknown> }).args;
        const recipient = String(logArgs?.recipient ?? '');
        if (!isWalletAddress(recipient) || recipient.toLowerCase() !== contactKey) {
          continue;
        }

        const userCiphertext = extractUserCiphertext(logArgs?.messageForSender);
        let messageText = '(Unable to decrypt message)';
        let replyToMessageId: string | undefined;
        let replyToText: string | undefined;
        let replyToTxHash: string | undefined;
        let replyToBlockNumber: number | undefined;
        let replyToLogIndex: number | undefined;
        let reactionToTxHash: string | undefined;
        let reactionToBlockNumber: number | undefined;
        let reactionToLogIndex: number | undefined;
        let reactionEmoji: string | undefined;

        if (userCiphertext && userCiphertext.value.length > 0) {
          try {
            const plain = await decryptMemoPlaintextWithRecovery(signer, cacheKey, userCiphertext);
            if (recipient.toLowerCase() === walletKey) {
              const backupPayload = parseStateBackupText(plain);
              if (backupPayload) {
                continue;
              }
              continue;
            }

            const parsedMessage = parseChatMessagePayload(plain);
            messageText = parsedMessage.cleanText;
            replyToMessageId = parsedMessage.replyToMessageId;
            replyToText = parsedMessage.replyToText;
            replyToTxHash = parsedMessage.replyToTxHash;
            replyToBlockNumber = parsedMessage.replyToBlockNumber;
            replyToLogIndex = parsedMessage.replyToLogIndex;
            reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
            reactionToBlockNumber = parsedMessage.embeddedReaction?.targetBlockNumber;
            reactionToLogIndex = parsedMessage.embeddedReaction?.targetLogIndex;
            reactionEmoji = parsedMessage.embeddedReaction?.emoji;
            if (parsedMessage.embeddedContactName) {
              discoveredNicknames.set(recipient.toLowerCase(), parsedMessage.embeddedContactName);
            }
            if (
              messageText.trim().length === 0 &&
              (parsedMessage.embeddedContactName || parsedMessage.embeddedConversationState)
            ) {
              continue;
            }
          } catch {
            messageText = '(Unable to decrypt message)';
          }
        }

        entries.push({
          id: `${log.transactionHash}-${log.index}-out`,
          contact: recipient,
          direction: 'outgoing',
          text: messageText,
          replyToMessageId,
          replyToText,
          replyToTxHash,
          replyToBlockNumber,
          replyToLogIndex,
          reactionToTxHash,
          reactionToBlockNumber,
          reactionToLogIndex,
          reactionEmoji,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          timestamp: blockTimestampMap.get(log.blockNumber)
        });
      }

      if (entries.length > 0) {
        setMessagesByContact((previous) =>
          mergeDirectHistoryEntries(previous, entries, requestedWalletAddress, {
            pruneOptimisticOutgoing: false
          })
        );
      }
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const onChainNicknames = await fetchOnChainNicknames([contactAddress]);
      const onChainNicknameForContact = onChainNicknames.get(contactKey);
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      if (discoveredNicknames.size > 0 || onChainNicknameForContact) {
        setContacts((previous) =>
          previous.map((contact) => {
            const nickname =
              discoveredNicknames.get(contact.address.toLowerCase()) ??
              onChainNicknames.get(contact.address.toLowerCase());
            if (!nickname || contact.name === nickname) {
              return contact;
            }

            return {
              ...contact,
              name: nickname
            };
          })
        );
      }
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load older history.';
      setError(message);
    } finally {
      loadingOlderHistoryRef.current = false;
      setLoadingOlderHistory(false);
    }
  };

  const { activeContact, activeGroupId, activeMessagesLength, hasAesReady, walletAddress } = args;
  useEffect(() => {
    if (
      !activeContact ||
      activeGroupId !== null ||
      syncingHistoryRef.current ||
      loadingOlderHistoryRef.current ||
      !walletAddress ||
      !hasAesReady
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
    hasAesReady,
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
