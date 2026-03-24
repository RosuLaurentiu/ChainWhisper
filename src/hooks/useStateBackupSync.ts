import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import {
  buildStateBackupPayload,
  buildStateBackupText,
  CHAT_CONTRACT_ABI,
  CHAT_CONTRACT_ADDRESS,
  COTI_NETWORK,
  createStateBackupFingerprint,
  debugLog,
  decodeMemoPlaintext,
  extractUserCiphertext,
  isWalletAddress,
  loadCotiEthersModule,
  loadCotiReadProvider,
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
} from '../lib/appShared';

type MemoSignerBundle = {
  signer: Wallet | JsonRpcSigner;
  cacheKey: string;
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
  resolveConversationBlockRangeRef: MutableRefObject<
    (contract: unknown, me: string, peer: string) => Promise<ConversationBlockRange | null>
  >;
  resolveRequiredFeeForSendRef: MutableRefObject<() => Promise<bigint>>;
  resolveSubmitSelectorRef: MutableRefObject<() => Promise<string>>;
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
  resolveConversationBlockRangeRef,
  resolveRequiredFeeForSendRef,
  resolveSubmitSelectorRef,
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
  const lastReadStateBackupSubmittedAtRef = useRef(0);

  const clearCachedStateBackupMemo = useCallback(() => {
    cachedStateBackupMemoRef.current = {};
  }, []);

  const clearScheduledReadStateBackup = useCallback(() => {
    if (readStateBackupTimerRef.current !== null) {
      window.clearTimeout(readStateBackupTimerRef.current);
      readStateBackupTimerRef.current = null;
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
      if (!isWalletAddress(targetAddress)) {
        return false;
      }

      try {
        const { signer, cacheKey } = await getMemoSignerRef.current();
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, readProvider);
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
                const plain = decodeMemoPlaintext(raw);
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
        while (windowEnd >= earliestSelfConversationBlock && !latestPayload) {
          const windowStart = Math.max(earliestSelfConversationBlock, windowEnd - SELF_BACKUP_RESTORE_BLOCK_WINDOW + 1);
          const windowLogs = await contract.queryFilter(selfFilter, windowStart, windowEnd);
          await tryDecodeBackupLogs(windowLogs as Array<{ blockNumber: number; index: number; args?: Record<string, unknown> }>);

          if (windowStart <= earliestSelfConversationBlock) {
            break;
          }

          windowEnd = windowStart - 1;
        }

        if (!latestPayload) {
          return false;
        }

        applyStateBackupPayload(targetAddress.toLowerCase(), latestPayload, latestPayloadBlockNumber);

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
    [applyStateBackupPayload, getMemoSignerRef, resolveConversationBlockRangeRef, setSessionOnboardInfo, walletAddress]
  );

  const runPostConnectDataSyncUntilApplied = useCallback(
    async (address: string): Promise<void> => {
      const targetAddress = address.trim().toLowerCase();
      if (!isWalletAddress(targetAddress)) {
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
      restoreStateFromChainSelfBackup
    ]
  );

  const backupLocalStateToSelf = useCallback(
    async (options?: BackupLocalStateOptions) => {
      if (backupInFlightRef.current) {
        return;
      }

      if (!walletAddress || !isWalletAddress(walletAddress)) {
        return;
      }

      const walletKey = walletAddress.toLowerCase();

      try {
        backupInFlightRef.current = true;

        const { signer, cacheKey } = await getMemoSignerRef.current();
        const selector = await resolveSubmitSelectorRef.current();
        const snapshotLastReadAllTs = normalizeLastReadAllTs(lastReadAllTsRef.current);
        const payload = buildStateBackupPayload(snapshotLastReadAllTs);
        const nextFingerprint = createStateBackupFingerprint(snapshotLastReadAllTs);
        if (!options?.force && lastBackedUpStateFingerprintRef.current[walletKey] === nextFingerprint) {
          return;
        }

        const backupText = buildStateBackupText(payload);
        const encodedMemo = encodeMemoForActiveSignerRef.current(backupText);
        const cotiEthers = await loadCotiEthersModule();
        const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, signer);
        const requiredFee = await resolveRequiredFeeForSendRef.current();
        const cachedMemoEntry = cachedStateBackupMemoRef.current[walletKey];
        const hasReusableMemo = cachedMemoEntry?.fingerprint === nextFingerprint;

        const buildMemoPayload = async (): Promise<SubmitMemoPayload> => {
          const encryptedMemo = await signer.encryptValue(encodedMemo, CHAT_CONTRACT_ADDRESS, selector);
          return parseSubmitMemoPayload(encryptedMemo);
        };

        let memoPayload = hasReusableMemo ? cachedMemoEntry.memo : await buildMemoPayload();
        if (!hasReusableMemo) {
          cachedStateBackupMemoRef.current[walletKey] = { fingerprint: nextFingerprint, memo: memoPayload };
        }

        const submitWithMemoPayload = async (payloadToSubmit: SubmitMemoPayload): Promise<void> => {
          const memoTuple = [[payloadToSubmit.ciphertextValue], payloadToSubmit.signature] as const;
          await contract.submit(walletAddress, memoTuple, { value: requiredFee });
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
      resolveRequiredFeeForSendRef,
      resolveSubmitSelectorRef,
      setSessionOnboardInfo,
      walletAddress
    ]
  );

  useEffect(() => {
    const normalizedWalletAddress = walletAddress.trim();
    const hasReadableState = normalizeLastReadAllTs(lastReadAllTs) > 0;
    const canAutoBackupReadState =
      isWalletAddress(normalizedWalletAddress) &&
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
  }, [backupLocalStateToSelf, chainId, clearScheduledReadStateBackup, hasAesReady, lastReadAllTs, walletAddress]);

  useEffect(() => {
    lastReadStateBackupSubmittedAtRef.current = 0;
    clearScheduledReadStateBackup();
  }, [clearScheduledReadStateBackup, walletAddress]);

  useEffect(() => {
    return () => {
      clearScheduledReadStateBackup();
    };
  }, [clearScheduledReadStateBackup]);

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
