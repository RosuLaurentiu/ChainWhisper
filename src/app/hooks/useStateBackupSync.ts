import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import {
  buildStateBackupPayload,
  buildStateBackupText,
  COTI_NETWORK,
  createStateBackupFingerprint,
  debugLog,
  decodeMemoPlaintextStrict,
  extractUserCiphertext,
  isWalletAddress,
  LEGACY_CHAT_BACKUP_CONTRACT_ABI,
  LEGACY_CHAT_BACKUP_CONTRACT_ADDRESS,
  loadCotiEthersModule,
  loadCotiReadProvider,
  loadCotiWsProvider,
  mergeOnboardInfo,
  normalizeLastReadAllTs,
  parseStateBackupText,
  parseSubmitMemoPayload,
  READ_STATE_BACKUP_DEBOUNCE_MS,
  READ_STATE_BACKUP_MIN_INTERVAL_MS,
  SELF_BACKUP_RESTORE_BLOCK_WINDOW,
  type BackupLocalStateOptions,
  type ConversationBlockRange,
  type StateBackupPayload,
  type SubmitMemoPayload
} from '../../lib/appShared';
import { isWalletTransactionFlowActive } from '../../lib/walletTransactionFlow';

type MemoSignerBundle = {
  signer: Wallet | JsonRpcSigner;
  cacheKey: string;
};

type RestoreCacheEntry = {
  block: number;
  version: number;
  updatedAt: number;
  lastReadAllTs: number;
};

const RESTORE_CACHE_KEY_PREFIX = 'coti-chat-restore-cache:';

const loadRestoreCache = (walletKey: string): RestoreCacheEntry | null => {
  try {
    const raw = window.localStorage.getItem(`${RESTORE_CACHE_KEY_PREFIX}${walletKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as RestoreCacheEntry).block !== 'number' ||
      typeof (parsed as RestoreCacheEntry).version !== 'number' ||
      typeof (parsed as RestoreCacheEntry).updatedAt !== 'number' ||
      typeof (parsed as RestoreCacheEntry).lastReadAllTs !== 'number'
    ) {
      return null;
    }
    return parsed as RestoreCacheEntry;
  } catch {
    return null;
  }
};

const saveRestoreCache = (walletKey: string, block: number, payload: StateBackupPayload): void => {
  try {
    const entry: RestoreCacheEntry = {
      block,
      version: payload.version,
      updatedAt: payload.updatedAt,
      lastReadAllTs: payload.lastReadAllTs ?? 0
    };
    window.localStorage.setItem(`${RESTORE_CACHE_KEY_PREFIX}${walletKey}`, JSON.stringify(entry));
  } catch {
    // localStorage may be unavailable or full.
  }
};

type UseStateBackupSyncArgs = {
  beginConnectSoundSuppression: (fallbackMs?: number) => number;
  chainId: number | null;
  currentWalletKeyRef: MutableRefObject<string>;
  encodeMemoForActiveSignerRef: MutableRefObject<(plain: string) => string>;
  endConnectSoundSuppression: (token?: number) => void;
  getMemoSignerRef: MutableRefObject<() => Promise<MemoSignerBundle>>;
  hasAesReady: boolean;
  lastReadAllTs: number;
  lastReadAllTsRef: MutableRefObject<number>;
  postConnectDataSyncRunIdRef: MutableRefObject<number>;
  readStateSyncEnabled: boolean;
  resolveConversationBlockRangeRef: MutableRefObject<
    (contract: unknown, me: string, peer: string) => Promise<ConversationBlockRange | null>
  >;
  resolveRequiredFeeForSendRef: MutableRefObject<() => Promise<bigint>>;
  resolveSubmitSelectorRef: MutableRefObject<() => Promise<string>>;
  runWalletTransactionFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  setLastReadAllTs: Dispatch<SetStateAction<number>>;
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  setUnreadGroupMap: Dispatch<SetStateAction<Record<string, boolean>>>;
  setUnreadMap: Dispatch<SetStateAction<Record<string, boolean>>>;
  unreadGroupMapRef: MutableRefObject<Record<string, boolean>>;
  unreadMapRef: MutableRefObject<Record<string, boolean>>;
  walletAddress: string;
};

export function useStateBackupSync({
  beginConnectSoundSuppression,
  chainId,
  currentWalletKeyRef,
  encodeMemoForActiveSignerRef,
  endConnectSoundSuppression,
  getMemoSignerRef,
  hasAesReady,
  lastReadAllTs,
  lastReadAllTsRef,
  postConnectDataSyncRunIdRef,
  readStateSyncEnabled,
  resolveConversationBlockRangeRef,
  runWalletTransactionFlow,
  setLastReadAllTs,
  setSessionOnboardInfo,
  setUnreadGroupMap,
  setUnreadMap,
  unreadGroupMapRef,
  unreadMapRef,
  walletAddress
}: UseStateBackupSyncArgs) {
  const backupInFlightRef = useRef(false);
  const lastAppliedStateBackupTsRef = useRef<Record<string, number>>({});
  const lastBackedUpStateFingerprintRef = useRef<Record<string, string>>({});
  const cachedStateBackupMemoRef = useRef<Record<string, { fingerprint: string; memo: SubmitMemoPayload }>>({});
  const lastStateBackupBlockRef = useRef<Record<string, number>>({});
  const lastAutoBackupAttemptBlockRef = useRef<Record<string, number>>({});
  const readStateBackupTimerRef = useRef<number | null>(null);
  const deferredStateBackupTimerRef = useRef<number | null>(null);
  const lastReadStateBackupSubmittedAtRef = useRef(0);
  const legacyBackupFeeCacheRef = useRef<bigint | null>(null);
  const legacyBackupFeeRequestRef = useRef<Promise<bigint> | null>(null);
  const backupLocalStateToSelfRef = useRef<(options?: BackupLocalStateOptions) => Promise<void>>(async () => {});

  const clearCachedStateBackupMemo = useCallback(() => {
    cachedStateBackupMemoRef.current = {};
  }, []);

  const clearScheduledReadStateBackup = useCallback(() => {
    if (readStateBackupTimerRef.current !== null) {
      window.clearTimeout(readStateBackupTimerRef.current);
      readStateBackupTimerRef.current = null;
    }
  }, []);

  const clearDeferredStateBackup = useCallback(() => {
    if (deferredStateBackupTimerRef.current !== null) {
      window.clearTimeout(deferredStateBackupTimerRef.current);
      deferredStateBackupTimerRef.current = null;
    }
  }, []);

  const scheduleDeferredStateBackup = useCallback(
    (options?: BackupLocalStateOptions) => {
      if (deferredStateBackupTimerRef.current !== null) {
        return;
      }

      deferredStateBackupTimerRef.current = window.setTimeout(() => {
        deferredStateBackupTimerRef.current = null;
        backupLocalStateToSelfRef.current({ ...(options ?? {}), background: true }).catch(() => {});
      }, 3000);
    },
    []
  );

  const resolveLegacyBackupFee = useCallback(async (): Promise<bigint> => {
    if (legacyBackupFeeCacheRef.current !== null) {
      return legacyBackupFeeCacheRef.current;
    }

    if (!legacyBackupFeeRequestRef.current) {
      legacyBackupFeeRequestRef.current = (async () => {
        try {
          const cotiEthers = await loadCotiEthersModule();
          const readProvider = await loadCotiReadProvider(true);
          const readContract = new cotiEthers.Contract(
            LEGACY_CHAT_BACKUP_CONTRACT_ADDRESS,
            LEGACY_CHAT_BACKUP_CONTRACT_ABI,
            readProvider
          );
          const fee = await readContract.feeAmount();
          const normalizedFee = typeof fee === 'bigint' ? fee : BigInt(String(fee ?? '0'));
          legacyBackupFeeCacheRef.current = normalizedFee;
          return normalizedFee;
        } catch {
          return 0n;
        }
      })();
    }

    try {
      return await legacyBackupFeeRequestRef.current;
    } finally {
      legacyBackupFeeRequestRef.current = null;
    }
  }, []);

  const applyStateBackupPayload = useCallback(
    (walletKey: string, payload: StateBackupPayload, backupBlockNumber?: number) => {
      const currentBackupTs = lastAppliedStateBackupTsRef.current[walletKey] ?? 0;
      if (payload.updatedAt < currentBackupTs) {
        return;
      }

      const snapshotLastReadAllTs = normalizeLastReadAllTs(payload.lastReadAllTs);

      if (snapshotLastReadAllTs > lastReadAllTsRef.current) {
        lastReadAllTsRef.current = snapshotLastReadAllTs;
        setLastReadAllTs((previous) => (snapshotLastReadAllTs > previous ? snapshotLastReadAllTs : previous));
        setUnreadMap((previous) => {
          if (Object.keys(previous).length === 0) {
            return previous;
          }
          unreadMapRef.current = {};
          return {};
        });
        setUnreadGroupMap((previous) => {
          if (Object.keys(previous).length === 0) {
            return previous;
          }
          unreadGroupMapRef.current = {};
          return {};
        });
      }

      lastAppliedStateBackupTsRef.current[walletKey] = payload.updatedAt;
      lastBackedUpStateFingerprintRef.current[walletKey] = createStateBackupFingerprint(snapshotLastReadAllTs);
      if (typeof backupBlockNumber === 'number' && Number.isFinite(backupBlockNumber)) {
        lastStateBackupBlockRef.current[walletKey] = backupBlockNumber;
        lastAutoBackupAttemptBlockRef.current[walletKey] = backupBlockNumber;
      }
      debugLog('[apply] applied state backup', {
        walletKey,
        updatedAt: payload.updatedAt,
        lastReadAllTs: snapshotLastReadAllTs
      });
    },
    [lastReadAllTsRef, setLastReadAllTs, setUnreadGroupMap, setUnreadMap, unreadGroupMapRef, unreadMapRef]
  );

  const restoreStateFromChainSelfBackup = useCallback(
    async (address?: string): Promise<boolean> => {
      const targetAddress = (address ?? walletAddress).trim();
      if (!readStateSyncEnabled || !isWalletAddress(targetAddress)) {
        return false;
      }

      try {
        const walletKey = targetAddress.toLowerCase();
        const restoreCache = loadRestoreCache(walletKey);

        const { signer, cacheKey } = await getMemoSignerRef.current();
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const contract = new cotiEthers.Contract(
          LEGACY_CHAT_BACKUP_CONTRACT_ADDRESS,
          LEGACY_CHAT_BACKUP_CONTRACT_ABI,
          readProvider
        );
        const latestBlock = await readProvider.getBlockNumber();
        const selfFilter = contract.filters.MessageSubmitted(targetAddress, targetAddress);
        const selfConversationRange = await resolveConversationBlockRangeRef.current(
          contract,
          targetAddress,
          targetAddress
        );
        if (!selfConversationRange || selfConversationRange.lastBlock <= 0) {
          return false;
        }

        const latestSelfConversationBlock = Math.min(latestBlock, selfConversationRange.lastBlock);
        const earliestSelfConversationBlock = Math.max(
          0,
          Math.min(selfConversationRange.firstBlock, latestSelfConversationBlock)
        );

        // When a cache exists, only scan blocks newer than the cached backup.
        // If nothing newer is found, the cache is still the latest state.
        const scanFloor =
          restoreCache && restoreCache.block > earliestSelfConversationBlock
            ? restoreCache.block + 1
            : earliestSelfConversationBlock;

        let latestPayload: StateBackupPayload | null = null;
        let latestPayloadBlockNumber: number | undefined;

        const tryDecodeBackupLogs = async (
          logs: Array<{
            blockNumber: number;
            index: number;
            args?: Record<string, unknown>;
          }>
        ) => {
          if (logs.length === 0 || latestPayload) {
            return;
          }

          const sortedLogs = [...logs].sort((left, right) => {
            if (left.blockNumber !== right.blockNumber) {
              return right.blockNumber - left.blockNumber;
            }

            return right.index - left.index;
          });

          for (const log of sortedLogs) {
            const args = (log as { args?: Record<string, unknown> }).args;
            const ciphertextCandidates = [
              extractUserCiphertext(args?.messageForSender),
              extractUserCiphertext(args?.messageForRecipient)
            ];

            for (const candidate of ciphertextCandidates) {
              if (!candidate || candidate.value.length === 0) {
                continue;
              }

              try {
                const decrypted = await signer.decryptValue(candidate as never);
                const raw = typeof decrypted === 'string' ? decrypted : decrypted.toString();
                const plain = decodeMemoPlaintextStrict(raw);
                if (plain === null) {
                  continue;
                }
                const parsed = parseStateBackupText(plain);
                if (parsed) {
                  latestPayload = parsed;
                  latestPayloadBlockNumber = log.blockNumber;
                  return;
                }
              } catch {
                // Ignore malformed or non-backup self-memos.
              }
            }
          }
        };

        if (latestSelfConversationBlock > 0) {
          const headLogs = await contract.queryFilter(selfFilter, latestSelfConversationBlock, latestSelfConversationBlock);
          await tryDecodeBackupLogs(headLogs as Array<{ blockNumber: number; index: number; args?: Record<string, unknown> }>);
        }

        let windowEnd = latestSelfConversationBlock;
        while (windowEnd >= scanFloor && !latestPayload) {
          const windowStart = Math.max(scanFloor, windowEnd - SELF_BACKUP_RESTORE_BLOCK_WINDOW + 1);
          const windowLogs = await contract.queryFilter(selfFilter, windowStart, windowEnd);
          await tryDecodeBackupLogs(windowLogs as Array<{ blockNumber: number; index: number; args?: Record<string, unknown> }>);

          if (windowStart <= scanFloor) {
            break;
          }

          windowEnd = windowStart - 1;
        }

        // No newer backup found on-chain — fall back to cached payload if available.
        if (!latestPayload && restoreCache && restoreCache.block >= earliestSelfConversationBlock) {
          latestPayload = {
            version: restoreCache.version,
            updatedAt: restoreCache.updatedAt,
            lastReadAllTs: restoreCache.lastReadAllTs
          };
          latestPayloadBlockNumber = restoreCache.block;
        }

        if (!latestPayload) {
          return false;
        }

        applyStateBackupPayload(walletKey, latestPayload, latestPayloadBlockNumber);
        if (typeof latestPayloadBlockNumber === 'number') {
          saveRestoreCache(walletKey, latestPayloadBlockNumber, latestPayload);
        }

        const nextOnboardInfo = signer.getUserOnboardInfo();
        setSessionOnboardInfo((previous) => ({
          ...previous,
          [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
        }));
        return true;
      } catch {
        return false;
      }
    },
    [
      applyStateBackupPayload,
      getMemoSignerRef,
      readStateSyncEnabled,
      resolveConversationBlockRangeRef,
      setSessionOnboardInfo,
      walletAddress
    ]
  );

  const runPostConnectDataSyncUntilApplied = useCallback(
    async (address: string): Promise<void> => {
      const targetAddress = address.trim().toLowerCase();
      if (!readStateSyncEnabled || !isWalletAddress(targetAddress)) {
        return;
      }

      const soundSuppressionToken = beginConnectSoundSuppression();
      const runId = ++postConnectDataSyncRunIdRef.current;

      try {
        for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
          if (runId !== postConnectDataSyncRunIdRef.current) {
            return;
          }

          if (currentWalletKeyRef.current !== targetAddress) {
            return;
          }

          if (normalizeLastReadAllTs(lastReadAllTsRef.current) > 0) {
            return;
          }

          const restored = await restoreStateFromChainSelfBackup(targetAddress);
          if (restored) {
            return;
          }

          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 1500);
          });
        }
      } finally {
        if (runId === postConnectDataSyncRunIdRef.current) {
          endConnectSoundSuppression(soundSuppressionToken);
        }
      }
    },
    [
      beginConnectSoundSuppression,
      currentWalletKeyRef,
      endConnectSoundSuppression,
      lastReadAllTsRef,
      postConnectDataSyncRunIdRef,
      readStateSyncEnabled,
      restoreStateFromChainSelfBackup
    ]
  );

  const backupLocalStateToSelf = useCallback(
    async (options?: BackupLocalStateOptions) => {
      if (options?.background && isWalletTransactionFlowActive()) {
        scheduleDeferredStateBackup(options);
        return;
      }

      if (backupInFlightRef.current) {
        return;
      }

      if (!readStateSyncEnabled || !walletAddress || !isWalletAddress(walletAddress)) {
        return;
      }

      const walletKey = walletAddress.toLowerCase();

      try {
        backupInFlightRef.current = true;

        await runWalletTransactionFlow(async () => {
          const { signer, cacheKey } = await getMemoSignerRef.current();
          const cotiEthers = await loadCotiEthersModule();
          const selector = new cotiEthers.Interface(LEGACY_CHAT_BACKUP_CONTRACT_ABI).getFunction('submit')?.selector;
          if (!selector) {
            return;
          }
          const snapshotLastReadAllTs = normalizeLastReadAllTs(lastReadAllTsRef.current);
          const payload = buildStateBackupPayload(snapshotLastReadAllTs);
          const nextFingerprint = createStateBackupFingerprint(snapshotLastReadAllTs);
          if (!options?.force && lastBackedUpStateFingerprintRef.current[walletKey] === nextFingerprint) {
            return;
          }

          const backupText = buildStateBackupText(payload);
          const encodedMemo = encodeMemoForActiveSignerRef.current(backupText);
          const contract = new cotiEthers.Contract(
            LEGACY_CHAT_BACKUP_CONTRACT_ADDRESS,
            LEGACY_CHAT_BACKUP_CONTRACT_ABI,
            signer
          );
          const requiredFee = await resolveLegacyBackupFee();
          const cachedMemoEntry = cachedStateBackupMemoRef.current[walletKey];
          const hasReusableMemo = cachedMemoEntry?.fingerprint === nextFingerprint;

          const buildMemoPayload = async (): Promise<SubmitMemoPayload> => {
            const encryptedMemo = await signer.encryptValue(encodedMemo, LEGACY_CHAT_BACKUP_CONTRACT_ADDRESS, selector);
            return parseSubmitMemoPayload(encryptedMemo);
          };

          let memoPayload = hasReusableMemo ? cachedMemoEntry.memo : await buildMemoPayload();
          if (!hasReusableMemo) {
            cachedStateBackupMemoRef.current[walletKey] = { fingerprint: nextFingerprint, memo: memoPayload };
          }

          const submitWithMemoPayload = async (payloadToSubmit: SubmitMemoPayload): Promise<void> => {
            const memoTuple = [[payloadToSubmit.ciphertextValue], payloadToSubmit.signature] as const;
            const tx = await contract.submit(walletAddress, memoTuple, { value: requiredFee });
            if (typeof (tx as { wait?: () => Promise<unknown> }).wait === 'function') {
              await (tx as { wait: () => Promise<unknown> }).wait();
            }
          };

          try {
            await submitWithMemoPayload(memoPayload);
          } catch (submitError) {
            if (!hasReusableMemo) {
              throw submitError;
            }

            memoPayload = await buildMemoPayload();
            cachedStateBackupMemoRef.current[walletKey] = { fingerprint: nextFingerprint, memo: memoPayload };
            await submitWithMemoPayload(memoPayload);
          }

          applyStateBackupPayload(walletKey, payload);
          lastBackedUpStateFingerprintRef.current[walletKey] = nextFingerprint;
          lastAppliedStateBackupTsRef.current[walletKey] = payload.updatedAt;

          const nextOnboardInfo = signer.getUserOnboardInfo();
          setSessionOnboardInfo((previous) => ({
            ...previous,
            [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
          }));
        });
      } catch {
        // Background backup failures should not interrupt the UI.
      } finally {
        backupInFlightRef.current = false;
      }
    },
    [
      applyStateBackupPayload,
      encodeMemoForActiveSignerRef,
      getMemoSignerRef,
      lastReadAllTsRef,
      readStateSyncEnabled,
      resolveLegacyBackupFee,
      runWalletTransactionFlow,
      scheduleDeferredStateBackup,
      setSessionOnboardInfo,
      walletAddress
    ]
  );

  useEffect(() => {
    backupLocalStateToSelfRef.current = backupLocalStateToSelf;
  }, [backupLocalStateToSelf]);

  useEffect(() => {
    const normalizedWalletAddress = walletAddress.trim();
    const hasReadableState = normalizeLastReadAllTs(lastReadAllTs) > 0;
    const canAutoBackupReadState =
      isWalletAddress(normalizedWalletAddress) &&
      readStateSyncEnabled &&
      hasAesReady &&
      chainId === COTI_NETWORK.chainIdDecimal &&
      hasReadableState;

    if (!canAutoBackupReadState) {
      clearScheduledReadStateBackup();
      return;
    }

    if (readStateBackupTimerRef.current !== null) {
      return;
    }

    const now = Date.now();
    const dueAt = Math.max(
      now + READ_STATE_BACKUP_DEBOUNCE_MS,
      lastReadStateBackupSubmittedAtRef.current + READ_STATE_BACKUP_MIN_INTERVAL_MS
    );
    const delay = Math.max(0, dueAt - now);

    readStateBackupTimerRef.current = window.setTimeout(() => {
      readStateBackupTimerRef.current = null;
      lastReadStateBackupSubmittedAtRef.current = Date.now();
      backupLocalStateToSelf({ background: true }).catch(() => {});
    }, delay);
  }, [
    backupLocalStateToSelf,
    chainId,
    clearScheduledReadStateBackup,
    hasAesReady,
    lastReadAllTs,
    readStateSyncEnabled,
    walletAddress
  ]);

  // Listen for new self-memos via WebSocket so read state stays in sync across
  // devices without waiting for the next connect.
  useEffect(() => {
    if (!readStateSyncEnabled || !isWalletAddress(walletAddress) || !hasAesReady || chainId !== COTI_NETWORK.chainIdDecimal) {
      return;
    }

    let cancelled = false;
    let debounceTimer: number | null = null;
    let offListener: (() => void) | null = null;

    const scheduleRemoteRestore = () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        if (!cancelled) {
          restoreStateFromChainSelfBackup().catch(() => {});
        }
      }, 3000);
    };

    const setup = async () => {
      try {
        const [cotiEthers, wsProvider] = await Promise.all([loadCotiEthersModule(), loadCotiWsProvider()]);
        if (cancelled) return;
        const contract = new cotiEthers.Contract(
          LEGACY_CHAT_BACKUP_CONTRACT_ADDRESS,
          LEGACY_CHAT_BACKUP_CONTRACT_ABI,
          wsProvider
        );
        const selfFilter = contract.filters.MessageSubmitted(walletAddress, walletAddress);
        contract.on(selfFilter, scheduleRemoteRestore);
        offListener = () => contract.off(selfFilter, scheduleRemoteRestore);
      } catch {
        // WS unavailable — skip; the restore cache handles sync on next connect.
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      offListener?.();
    };
  }, [chainId, hasAesReady, readStateSyncEnabled, restoreStateFromChainSelfBackup, walletAddress]);

  useEffect(() => {
    lastReadStateBackupSubmittedAtRef.current = 0;
    clearScheduledReadStateBackup();
  }, [clearScheduledReadStateBackup, walletAddress]);

  useEffect(() => {
    return () => {
      clearScheduledReadStateBackup();
      clearDeferredStateBackup();
    };
  }, [clearDeferredStateBackup, clearScheduledReadStateBackup]);

  return {
    applyStateBackupPayload,
    backupLocalStateToSelf,
    clearCachedStateBackupMemo,
    lastAppliedStateBackupTsRef,
    lastAutoBackupAttemptBlockRef,
    lastBackedUpStateFingerprintRef,
    lastStateBackupBlockRef,
    runPostConnectDataSyncUntilApplied
  };
}
