import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import {
  BURNER_TOP_UP_DEFAULT_MESSAGE_TARGET,
  BURNER_WALLET_VAULT_VERSION,
  BURNER_WALLET_STORAGE_KEY,
  BURNER_ONBOARD_TIMEOUT_MS,
  BURNER_PIN_MIN_LENGTH,
  calculateEstimatedBurnerTopUpAmount,
  COTI_NETWORK,
  createCotiBrowserProvider,
  createBurnerWalletVault,
  getProviderErrorMessage,
  hasInsufficientFundsError,
  isBurnerStorageAvailable,
  isWalletAddress,
  LEGACY_BURNER_PIN_MIN_LENGTH,
  loadBurnerWalletVaultFromOwnerAesStorage,
  loadBurnerWalletVaultFromStorage,
  loadCotiEthersModule,
  migrateLegacyBurnerWalletVaultStorage,
  mergeOnboardInfo,
  parseBurnerWalletStorageState,
  saveOwnerAesBurnerWalletVault,
  withTimeout,
  type BurnerInitMode,
  type BurnerInitResult,
  type BurnerPinMode,
  type BurnerWalletRecord,
  type BurnerWalletVault,
  type Eip1193Provider,
  type InjectedWalletOption,
  type PendingBurnerInit,
  type SensitiveAction,
  type SignerSource
} from '../../../lib/appShared';
import { saveWalletPreference } from '../../../lib/appStorage';
import {
  buildNewBurnerWalletRecord,
  loadStoredBurnerWalletRecord,
  resaveBurnerWalletVaultWithPin,
  saveBurnerWalletRecordWithOwnerAes,
  saveBurnerWalletRecordWithPin
} from '../../../lib/burnerWalletVault';
import {
  APP_WALLET_RECOVERY_NOT_FOUND_MESSAGE,
  buildAppWalletRecoveryPromptEstimateMessage,
  decryptAppWalletRecoveryGcProfile,
  estimateAppWalletRecoveryPromptLoad,
  isAppWalletRecoveryConfigured,
  isAppWalletRecoveryNotFoundError,
  readAppWalletRecoveryProfiles,
  saveAppWalletRecoveryProfile,
  setDefaultAppWalletRecoveryProfile,
  clearAppWalletRecoveryProfile,
  type AppWalletRecoveryPromptEstimate
} from '../../../lib/appWalletRecovery';
import { getCotiSnapOwnerAesKeyResult, getCotiSnapOwnerAesStatusMessage } from '../../../lib/cotiSnap';
import { getOrRecoverAesForWallet } from '../../../lib/cotiAesUnlock';
import type { BrowserWalletSession } from './useWalletOnboarding';

type OwnerAesRecoveryMode = 'auto' | 'manual';
export type OwnerAesRecoveryResult = 'recovered' | 'not-found' | 'failed';

export type RecoverySavePromptState = {
  estimate: AppWalletRecoveryPromptEstimate;
  makeDefault: boolean;
  message: string;
};

type RecoverySaveChoice = {
  makeDefault: boolean;
  shouldSave: boolean;
};

type UseBurnerWalletArgs = {
  activeSignerSource: SignerSource;
  browserWalletSession: BrowserWalletSession | null;
  currentWalletKeyRef: MutableRefObject<string>;
  ensureCotiNetwork: (provider: Eip1193Provider) => Promise<void>;
  loadMyNicknameFromChainRef: MutableRefObject<(address: string) => Promise<string>>;
  preferredInjectedWalletOption: InjectedWalletOption | null;
  runWalletTransactionFlow?: <T>(operation: () => Promise<T>) => Promise<T>;
  runPostConnectDataSyncUntilAppliedRef: MutableRefObject<(address: string) => Promise<void>>;
  schedulePostUnlockRefresh: () => void;
  sessionOnboardInfo: Record<string, OnboardInfo>;
  setActiveSignerSource: Dispatch<SetStateAction<SignerSource>>;
  setChainId: Dispatch<SetStateAction<number | null>>;
  setConnectedProvider: (provider: Eip1193Provider | null) => void;
  setConnectionMethod: Dispatch<SetStateAction<'metamask' | null>>;
  setError: Dispatch<SetStateAction<string>>;
  setMyNickname: Dispatch<SetStateAction<string>>;
  setOnboardStatus: Dispatch<SetStateAction<string>>;
  setSelectedInjectedWalletId: Dispatch<SetStateAction<string>>;
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setWalletAddress: Dispatch<SetStateAction<string>>;
  topUpAmountWei: bigint | null;
  walletAddress: string;
};

export function useBurnerWallet({
  activeSignerSource,
  browserWalletSession,
  currentWalletKeyRef,
  ensureCotiNetwork,
  loadMyNicknameFromChainRef,
  preferredInjectedWalletOption,
  runWalletTransactionFlow,
  runPostConnectDataSyncUntilAppliedRef,
  schedulePostUnlockRefresh,
  sessionOnboardInfo,
  setActiveSignerSource,
  setChainId,
  setConnectedProvider,
  setConnectionMethod,
  setError,
  setMyNickname,
  setOnboardStatus,
  setSelectedInjectedWalletId,
  setSessionOnboardInfo,
  setStatus,
  setWalletAddress,
  topUpAmountWei,
  walletAddress
}: UseBurnerWalletArgs) {
  const [burnerMnemonicBackup, setBurnerMnemonicBackup] = useState('');
  const [showBurnerMnemonic, setShowBurnerMnemonic] = useState(false);
  const [burnerImportInput, setBurnerImportInput] = useState('');
  const [burnerWallets, setBurnerWallets] = useState<BurnerWalletRecord[]>([]);
  const [savedBurnerWalletCount, setSavedBurnerWalletCount] = useState(0);
  const [activeBurnerWalletId, setActiveBurnerWalletId] = useState('');
  const [showBurnerImportModal, setShowBurnerImportModal] = useState(false);
  const [burnerStorageBlocked, setBurnerStorageBlocked] = useState<boolean>(() => !isBurnerStorageAvailable());
  const [showBurnerPinModal, setShowBurnerPinModal] = useState(false);
  const [burnerPinMode, setBurnerPinMode] = useState<BurnerPinMode>('unlock');
  const [burnerPinInput, setBurnerPinInput] = useState('');
  const [pendingBurnerInit, setPendingBurnerInit] = useState<PendingBurnerInit | null>(null);
  const [pendingSensitiveAction, setPendingSensitiveAction] = useState<SensitiveAction | null>(null);
  const [initializingBurner, setInitializingBurner] = useState(false);
  const [recoveringAppWallet, setRecoveringAppWallet] = useState(false);
  const [checkingOwnerRecovery, setCheckingOwnerRecovery] = useState(false);
  const [ownerRecoveryError, setOwnerRecoveryError] = useState('');
  const [recoverySavePrompt, setRecoverySavePrompt] = useState<RecoverySavePromptState | null>(null);
  const [burnerNeedsFunding, setBurnerNeedsFunding] = useState(false);
  const [burnerBalanceWei, setBurnerBalanceWei] = useState<bigint | null>(null);
  const [topUpMessageTarget, setTopUpMessageTarget] = useState(BURNER_TOP_UP_DEFAULT_MESSAGE_TARGET);
  const [topUpMetricsNonce, setTopUpMetricsNonce] = useState(0);

  const burnerWalletRef = useRef<Wallet | null>(null);
  const burnerRecordRef = useRef<BurnerWalletRecord | null>(null);
  const burnerPinRef = useRef('');
  const lastBurnerConnectErrorRef = useRef('');
  const recoverySavePromptResolverRef = useRef<((choice: RecoverySaveChoice) => void) | null>(null);

  const refreshBurnerStorageStatus = useCallback(() => {
    setBurnerStorageBlocked(!isBurnerStorageAvailable());
  }, []);

  useEffect(() => {
    return () => {
      recoverySavePromptResolverRef.current?.({ makeDefault: false, shouldSave: false });
      recoverySavePromptResolverRef.current = null;
    };
  }, []);

  useEffect(() => {
    refreshBurnerStorageStatus();
    const onVisibilityOrFocus = () => {
      refreshBurnerStorageStatus();
    };
    window.addEventListener('focus', onVisibilityOrFocus);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    return () => {
      window.removeEventListener('focus', onVisibilityOrFocus);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
    };
  }, [refreshBurnerStorageStatus]);

  useEffect(() => {
    setOwnerRecoveryError('');
  }, [walletAddress]);

  useEffect(() => {
    const ownerKey = browserWalletSession?.address?.trim().toLowerCase() ?? '';
    const hasCachedOwnerAes = Boolean(ownerKey && sessionOnboardInfo[ownerKey]?.aesKey?.trim());
    if (
      hasCachedOwnerAes &&
      /coti snap|grant aes|onboard this owner wallet|owner aes/i.test(ownerRecoveryError)
    ) {
      setOwnerRecoveryError('');
    }
  }, [browserWalletSession?.address, ownerRecoveryError, sessionOnboardInfo]);

  useEffect(() => {
    let cancelled = false;

    const syncSavedBurnerWalletCount = async () => {
      if (burnerStorageBlocked) {
        if (!cancelled) {
          setSavedBurnerWalletCount(0);
        }
        return;
      }

      const storageState = parseBurnerWalletStorageState();
      if (storageState.kind === 'none') {
        if (!cancelled) {
          setSavedBurnerWalletCount(0);
        }
        return;
      }

      if (storageState.kind === 'legacy') {
        if (!cancelled) {
          setSavedBurnerWalletCount(1);
        }
        return;
      }

      if (storageState.kind === 'legacy-vault') {
        if (!cancelled) {
          setSavedBurnerWalletCount(storageState.record.wallets.length);
        }
        return;
      }

      const currentPin = burnerPinRef.current.trim();
      if (currentPin.length >= LEGACY_BURNER_PIN_MIN_LENGTH) {
        try {
          const vault = await loadBurnerWalletVaultFromStorage(currentPin);
          if (!cancelled) {
            setSavedBurnerWalletCount(vault.wallets.length);
          }
          return;
        } catch {
          // Fall back to loaded wallet count.
        }
      }

      if (!cancelled) {
        setSavedBurnerWalletCount(Math.max(burnerWallets.length, 1));
      }
    };

    syncSavedBurnerWalletCount().catch(() => {
      if (!cancelled) {
        setSavedBurnerWalletCount(burnerWallets.length);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [burnerStorageBlocked, burnerWallets, walletAddress]);

  const createCotiRpcProvider = useCallback(async () => {
    const cotiEthers = await loadCotiEthersModule();
    return new cotiEthers.JsonRpcProvider(COTI_NETWORK.rpcUrl, {
      name: COTI_NETWORK.chainName,
      chainId: COTI_NETWORK.chainIdDecimal
    });
  }, []);

  const getBurnerRecordOnboardInfo = useCallback(
    (walletRecord?: BurnerWalletRecord | null): OnboardInfo | undefined => {
      const walletKey = walletRecord?.address?.trim().toLowerCase() ?? '';
      const savedInfo = walletRecord?.onboardInfo;
      const sessionInfo = walletKey ? sessionOnboardInfo[walletKey] : undefined;
      return mergeOnboardInfo(savedInfo, sessionInfo);
    },
    [sessionOnboardInfo]
  );

  const attachActiveBurnerOnboardInfoToVault = useCallback(
    async (vault: BurnerWalletVault): Promise<BurnerWalletVault> => {
      const activeWalletRecord =
        vault.wallets.find((walletRecord) => walletRecord.id === vault.activeWalletId) ?? vault.wallets[0];
      if (!activeWalletRecord) {
        return vault;
      }

      const activeWalletAddress = activeWalletRecord.address?.trim() || burnerWalletRef.current?.address || '';
      const activeWalletKey = activeWalletAddress.trim().toLowerCase();
      const signerOnboardInfo =
        burnerWalletRef.current && burnerWalletRef.current.address.toLowerCase() === activeWalletKey
          ? burnerWalletRef.current.getUserOnboardInfo()
          : undefined;
      const onboardInfo = mergeOnboardInfo(
        mergeOnboardInfo(activeWalletRecord.onboardInfo, activeWalletKey ? sessionOnboardInfo[activeWalletKey] : undefined),
        signerOnboardInfo
      );
      const aesKey = typeof onboardInfo?.aesKey === 'string' ? onboardInfo.aesKey.trim() : '';
      if (!aesKey) {
        return vault;
      }

      return createBurnerWalletVault(
        vault.wallets.map((walletRecord) =>
          walletRecord.id === activeWalletRecord.id
            ? {
                ...walletRecord,
                onboardInfo: { aesKey } as OnboardInfo
              }
            : walletRecord
        ),
        vault.activeWalletId
      );
    },
    [sessionOnboardInfo]
  );

  const persistRecoverySaveMetadata = useCallback(
    async ({
      makeDefault,
      ownerAddress,
      ownerAesKey,
      profileId,
      profileVersion,
      transactionHash,
      vault
    }: {
      makeDefault: boolean;
      ownerAddress: string;
      ownerAesKey: string;
      profileId: number;
      profileVersion: string;
      transactionHash: string;
      vault: BurnerWalletVault;
    }) => {
      const activeWalletRecord =
        vault.wallets.find((walletRecord) => walletRecord.id === vault.activeWalletId) ?? vault.wallets[0];
      if (!activeWalletRecord) {
        return;
      }

      const nextVault = await createBurnerWalletVault(
        vault.wallets.map((walletRecord) =>
          walletRecord.id === activeWalletRecord.id
            ? {
                ...walletRecord,
                recoveryDefault: makeDefault,
                recoveryProfileId: profileId,
                recoveryProfileVersion: profileVersion,
                recoveryTransactionHash: transactionHash
              }
            : makeDefault
              ? { ...walletRecord, recoveryDefault: false }
              : walletRecord
        ),
        vault.activeWalletId
      );
      const nextActiveWallet =
        nextVault.wallets.find((walletRecord) => walletRecord.id === nextVault.activeWalletId) ??
        nextVault.wallets[0];

      setBurnerWallets(nextVault.wallets);
      setActiveBurnerWalletId(nextVault.activeWalletId);
      if (nextActiveWallet) {
        burnerRecordRef.current = nextActiveWallet;
      }
      if (isBurnerStorageAvailable()) {
        await saveOwnerAesBurnerWalletVault(nextVault, ownerAddress, ownerAesKey);
        setSavedBurnerWalletCount(nextVault.wallets.length);
      }
    },
    []
  );

  const buildBurnerRecord = useCallback(
    async (
      mode: BurnerInitMode,
      seedOrPrivateKey?: string,
      pin?: string,
      preferredWalletId?: string
    ): Promise<{ record: BurnerWalletRecord; vault?: BurnerWalletVault }> => {
      if (mode === 'stored') {
        return loadStoredBurnerWalletRecord(pin?.trim() ?? '', preferredWalletId);
      }

      return {
        record: await buildNewBurnerWalletRecord(mode, seedOrPrivateKey)
      };
    },
    []
  );

  const initializeBurnerWallet = useCallback(
    async (
      mode: BurnerInitMode,
      seedOrPrivateKey?: string,
      pin?: string,
      preferredWalletId?: string
    ): Promise<BurnerInitResult> => {
      setError('');
      lastBurnerConnectErrorRef.current = '';
      setInitializingBurner(true);
      setBurnerNeedsFunding(false);
      let aesOnboardingComplete = false;
      let walletPersisted = false;

      try {
        const sessionPin = pin?.trim() ?? burnerPinRef.current;

        const buildResult = await buildBurnerRecord(mode, seedOrPrivateKey, sessionPin, preferredWalletId);
        let burnerRecord = buildResult.record;
        let burnerVault: BurnerWalletVault;
        if (sessionPin.length < BURNER_PIN_MIN_LENGTH) {
          throw new Error(`PIN must be at least ${BURNER_PIN_MIN_LENGTH} digits.`);
        }

        if (mode === 'stored') {
          if (!buildResult.vault) {
            throw new Error('No ChainWhisper account is saved here yet. Generate or import one first.');
          }
          burnerVault = buildResult.vault;
          await migrateLegacyBurnerWalletVaultStorage(sessionPin).catch(() => false);
        } else {
          burnerVault = await saveBurnerWalletRecordWithPin(burnerRecord, sessionPin);
        }

        walletPersisted = true;
        if (mode === 'import') {
          const normalizedImportedPrivateKey = buildResult.record.privateKey.trim().toLowerCase();
          const persistedVault = await loadBurnerWalletVaultFromStorage(sessionPin);
          const importedWalletPersisted = persistedVault.wallets.some(
            (walletRecord) => walletRecord.privateKey.trim().toLowerCase() === normalizedImportedPrivateKey
          );
          if (!importedWalletPersisted) {
            throw new Error('Imported wallet was not found in persistent storage after saving.');
          }
        }

        const activeWalletRecord =
          burnerVault.wallets.find((walletRecord) => walletRecord.id === burnerVault.activeWalletId) ??
          burnerVault.wallets[0];
        if (!activeWalletRecord) {
          throw new Error('No valid ChainWhisper account was found after unlock.');
        }

        burnerRecord = activeWalletRecord;
        setBurnerWallets(burnerVault.wallets);
        setActiveBurnerWalletId(burnerVault.activeWalletId);

        if (sessionPin.length >= BURNER_PIN_MIN_LENGTH) {
          burnerPinRef.current = sessionPin;
        }

        const cotiEthers = await loadCotiEthersModule();
        const rpcProvider = await createCotiRpcProvider();
        const burnerWallet = new cotiEthers.Wallet(burnerRecord.privateKey, rpcProvider);
        const recoveredOnboardInfo = getBurnerRecordOnboardInfo(burnerRecord);
        if (recoveredOnboardInfo?.aesKey) {
          burnerWallet.setUserOnboardInfo(recoveredOnboardInfo);
        }

        burnerWalletRef.current = burnerWallet;
        burnerRecordRef.current = {
          ...burnerRecord,
          address: burnerWallet.address
        };
        setWalletAddress(burnerWallet.address);
        setChainId(COTI_NETWORK.chainIdDecimal);
        setStatus('Connecting ChainWhisper account...');
        setActiveSignerSource('burner');
        setConnectionMethod(null);
        setConnectedProvider(null);
        setBurnerImportInput('');

        if (burnerRecord.mnemonic) {
          setBurnerMnemonicBackup(burnerRecord.mnemonic);
          setShowBurnerMnemonic(false);
        } else {
          setBurnerMnemonicBackup('');
          setShowBurnerMnemonic(false);
        }

        const burnerBalance = (await withTimeout(
          rpcProvider.getBalance(burnerWallet.address) as Promise<bigint>,
          BURNER_ONBOARD_TIMEOUT_MS,
          'Timed out while reading ChainWhisper account balance.'
        )) as bigint;
        if (burnerBalance <= 0n) {
          setBurnerNeedsFunding(true);
          setStatus('ChainWhisper account created. Fund it, then connect the account.');
          setOnboardStatus('Funding required');
          setShowBurnerPinModal(false);
          setPendingBurnerInit(null);
          setPendingSensitiveAction(null);
          setBurnerPinInput('');
          saveWalletPreference({ kind: 'app' });
          return 'needs-funding';
        }

        const cacheKey = burnerWallet.address.toLowerCase();
        const cachedOnboardInfo = sessionOnboardInfo[cacheKey];
        if (cachedOnboardInfo) {
          burnerWallet.setUserOnboardInfo(cachedOnboardInfo);
        }

        setOnboardStatus('Onboarding...');
        const onboardInfo = await withTimeout(
          getOrRecoverAesForWallet({
            signer: burnerWallet,
            walletAddress: burnerWallet.address
          }),
          BURNER_ONBOARD_TIMEOUT_MS,
          'Timed out while preparing ChainWhisper account encryption keys. Try again.'
        );

        if (!onboardInfo?.aesKey) {
          throw new Error('AES key unavailable for ChainWhisper account.');
        }

        setSessionOnboardInfo((previous) => ({
          ...previous,
          [cacheKey]: mergeOnboardInfo(previous[cacheKey], onboardInfo)
        }));
        aesOnboardingComplete = true;
        setOnboardStatus('AES key ready');
        setStatus('Connected');
        setShowBurnerPinModal(false);
        setPendingBurnerInit(null);
        setPendingSensitiveAction(null);
        setBurnerPinInput('');
        saveWalletPreference({ kind: 'app' });
        const connectedAddress = burnerWallet.address;
        const connectedWalletKey = connectedAddress.toLowerCase();
        window.setTimeout(() => {
          void (async () => {
            try {
              const nickname = await loadMyNicknameFromChainRef.current(connectedAddress);
              if (currentWalletKeyRef.current !== connectedWalletKey) {
                return;
              }
              setMyNickname(nickname);
            } catch {
              // Post-onboarding sync failures should not block a successful burner unlock.
            } finally {
              if (currentWalletKeyRef.current === connectedWalletKey) {
                runPostConnectDataSyncUntilAppliedRef.current(connectedAddress).catch(() => {});
              }
            }
          })();
        }, 0);
        return 'connected';
      } catch (burnerError) {
        if (aesOnboardingComplete) {
          setOnboardStatus('AES key ready');
          setStatus('Connected');
          setShowBurnerPinModal(false);
          setPendingBurnerInit(null);
          setPendingSensitiveAction(null);
          setBurnerPinInput('');
          return 'connected';
        }

        const message = burnerError instanceof Error ? burnerError.message : 'Failed to initialize ChainWhisper account.';
        lastBurnerConnectErrorRef.current = message;
        if (hasInsufficientFundsError(message)) {
          setBurnerNeedsFunding(true);
          setStatus('ChainWhisper account needs funding');
          return 'needs-funding';
        }
        if (mode === 'import' && walletPersisted) {
          setStatus('Wallet imported. Connect saved wallet to finish setup.');
          setError(message);
          setOnboardStatus('Not onboarded');
          return 'imported';
        }
        setStatus('Disconnected');
        setError(message);
        setOnboardStatus('Not onboarded');
        return 'failed';
      } finally {
        setInitializingBurner(false);
      }
    },
    [
      buildBurnerRecord,
      createCotiRpcProvider,
      currentWalletKeyRef,
      getBurnerRecordOnboardInfo,
      loadMyNicknameFromChainRef,
      runPostConnectDataSyncUntilAppliedRef,
      sessionOnboardInfo,
      setActiveSignerSource,
      setChainId,
      setConnectedProvider,
      setConnectionMethod,
      setError,
      setMyNickname,
      setOnboardStatus,
      setSessionOnboardInfo,
      setStatus,
      setWalletAddress
    ]
  );

  const connectBurnerWalletFromVault = useCallback(
    async (vault: BurnerWalletVault, preferredWalletId?: string): Promise<BurnerInitResult> => {
      setError('');
      lastBurnerConnectErrorRef.current = '';
      setInitializingBurner(true);
      setBurnerNeedsFunding(false);
      let aesOnboardingComplete = false;

      try {
        const burnerVault = await createBurnerWalletVault(vault.wallets, preferredWalletId ?? vault.activeWalletId);
        const burnerRecord =
          burnerVault.wallets.find((walletRecord) => walletRecord.id === burnerVault.activeWalletId) ??
          burnerVault.wallets[0];
        if (!burnerRecord) {
          throw new Error('Recovered ChainWhisper account backup did not contain a valid wallet.');
        }

        setBurnerWallets(burnerVault.wallets);
        setActiveBurnerWalletId(burnerVault.activeWalletId);

        const cotiEthers = await loadCotiEthersModule();
        const rpcProvider = await createCotiRpcProvider();
        const burnerWallet = new cotiEthers.Wallet(burnerRecord.privateKey, rpcProvider);
        const recoveredOnboardInfo = getBurnerRecordOnboardInfo(burnerRecord);
        if (recoveredOnboardInfo?.aesKey) {
          burnerWallet.setUserOnboardInfo(recoveredOnboardInfo);
        }

        burnerWalletRef.current = burnerWallet;
        burnerRecordRef.current = {
          ...burnerRecord,
          address: burnerWallet.address
        };
        setWalletAddress(burnerWallet.address);
        setChainId(COTI_NETWORK.chainIdDecimal);
        setStatus('Connecting recovered ChainWhisper account...');
        setActiveSignerSource('burner');
        setConnectionMethod(null);
        setConnectedProvider(null);
        setBurnerImportInput('');

        if (burnerRecord.mnemonic) {
          setBurnerMnemonicBackup(burnerRecord.mnemonic);
          setShowBurnerMnemonic(false);
        } else {
          setBurnerMnemonicBackup('');
          setShowBurnerMnemonic(false);
        }

        const burnerBalance = (await withTimeout(
          rpcProvider.getBalance(burnerWallet.address) as Promise<bigint>,
          BURNER_ONBOARD_TIMEOUT_MS,
          'Timed out while reading ChainWhisper account balance.'
        )) as bigint;
        if (burnerBalance <= 0n) {
          setBurnerNeedsFunding(true);
          setStatus('Recovered ChainWhisper account. Fund it, then connect the account.');
          setOnboardStatus('Funding required');
          saveWalletPreference({ kind: 'app' });
          return 'needs-funding';
        }

        const cacheKey = burnerWallet.address.toLowerCase();
        const cachedOnboardInfo = sessionOnboardInfo[cacheKey];
        if (cachedOnboardInfo) {
          burnerWallet.setUserOnboardInfo(cachedOnboardInfo);
        }

        setOnboardStatus('Onboarding...');
        const onboardInfo = await withTimeout(
          getOrRecoverAesForWallet({
            signer: burnerWallet,
            walletAddress: burnerWallet.address
          }),
          BURNER_ONBOARD_TIMEOUT_MS,
          'Timed out while preparing ChainWhisper account encryption keys. Try again.'
        );

        if (!onboardInfo?.aesKey) {
          throw new Error('AES key unavailable for recovered ChainWhisper account.');
        }

        setSessionOnboardInfo((previous) => ({
          ...previous,
          [cacheKey]: mergeOnboardInfo(previous[cacheKey], onboardInfo)
        }));
        aesOnboardingComplete = true;
        setOnboardStatus('AES key ready');
        setStatus('Connected');
        saveWalletPreference({ kind: 'app' });

        const connectedAddress = burnerWallet.address;
        const connectedWalletKey = connectedAddress.toLowerCase();
        window.setTimeout(() => {
          void (async () => {
            try {
              const nickname = await loadMyNicknameFromChainRef.current(connectedAddress);
              if (currentWalletKeyRef.current !== connectedWalletKey) {
                return;
              }
              setMyNickname(nickname);
            } catch {
              // Post-recovery sync failures should not block a successful app wallet unlock.
            } finally {
              if (currentWalletKeyRef.current === connectedWalletKey) {
                runPostConnectDataSyncUntilAppliedRef.current(connectedAddress).catch(() => {});
              }
            }
          })();
        }, 0);
        return 'connected';
      } catch (recoveryError) {
        if (aesOnboardingComplete) {
          setOnboardStatus('AES key ready');
          setStatus('Connected');
          return 'connected';
        }

        const message = recoveryError instanceof Error ? recoveryError.message : 'Failed to connect recovered ChainWhisper account.';
        lastBurnerConnectErrorRef.current = message;
        if (hasInsufficientFundsError(message)) {
          setBurnerNeedsFunding(true);
          setStatus('ChainWhisper account needs funding');
          return 'needs-funding';
        }
        setStatus('Disconnected');
        setError(message);
        setOnboardStatus('Not onboarded');
        return 'failed';
      } finally {
        setInitializingBurner(false);
      }
    },
    [
      createCotiRpcProvider,
      currentWalletKeyRef,
      getBurnerRecordOnboardInfo,
      loadMyNicknameFromChainRef,
      runPostConnectDataSyncUntilAppliedRef,
      sessionOnboardInfo,
      setActiveSignerSource,
      setChainId,
      setConnectedProvider,
      setConnectionMethod,
      setError,
      setMyNickname,
      setOnboardStatus,
      setSessionOnboardInfo,
      setStatus,
      setWalletAddress
    ]
  );

  const closeBurnerPinModal = useCallback(() => {
    if (initializingBurner) {
      return;
    }

    setShowBurnerPinModal(false);
    setPendingBurnerInit(null);
    setPendingSensitiveAction(null);
    setBurnerPinInput('');
  }, [initializingBurner]);

  const beginRevealBurnerBackup = useCallback(() => {
    if (!burnerMnemonicBackup) {
      return;
    }

    if (showBurnerMnemonic) {
      setShowBurnerMnemonic(false);
      return;
    }

    setError('');
    setPendingBurnerInit(null);

    const activeWalletId = activeBurnerWalletId || burnerRecordRef.current?.id || '';
    const activeWalletRecord =
      burnerWallets.find((walletRecord) => walletRecord.id === activeWalletId) ??
      burnerWallets.find((walletRecord) => walletRecord.mnemonic === burnerMnemonicBackup) ??
      null;
    const mnemonicLoadedInMemory =
      Boolean(activeWalletRecord?.privateKey?.trim()) && activeWalletRecord?.mnemonic === burnerMnemonicBackup;

    if (!burnerPinRef.current && mnemonicLoadedInMemory) {
      setShowBurnerMnemonic(true);
      return;
    }

    setPendingSensitiveAction('reveal-backup');
    setBurnerPinMode('unlock');
    setBurnerPinInput('');
    setShowBurnerPinModal(true);
  }, [activeBurnerWalletId, burnerMnemonicBackup, burnerWallets, setError, showBurnerMnemonic]);

  const closeBurnerBackup = useCallback(() => {
    setShowBurnerMnemonic(false);
  }, []);

  const resolveRecoverySavePrompt = useCallback((choice: RecoverySaveChoice) => {
    const resolver = recoverySavePromptResolverRef.current;
    recoverySavePromptResolverRef.current = null;
    setRecoverySavePrompt(null);
    resolver?.(choice);
  }, []);

  const cancelRecoverySavePrompt = useCallback(() => {
    resolveRecoverySavePrompt({ makeDefault: false, shouldSave: false });
  }, [resolveRecoverySavePrompt]);

  const confirmRecoverySavePrompt = useCallback(() => {
    resolveRecoverySavePrompt({
      makeDefault: recoverySavePrompt?.makeDefault ?? true,
      shouldSave: true
    });
  }, [recoverySavePrompt?.makeDefault, resolveRecoverySavePrompt]);

  const setRecoverySavePromptMakeDefault = useCallback((makeDefault: boolean) => {
    setRecoverySavePrompt((previous) => previous ? { ...previous, makeDefault } : previous);
  }, []);

  const requestRecoverySaveConfirmation = useCallback((vault: BurnerWalletVault): Promise<RecoverySaveChoice> => {
    const estimate = estimateAppWalletRecoveryPromptLoad(vault);
    const message = buildAppWalletRecoveryPromptEstimateMessage(estimate);

    recoverySavePromptResolverRef.current?.({ makeDefault: false, shouldSave: false });
    return new Promise((resolve) => {
      recoverySavePromptResolverRef.current = resolve;
      setRecoverySavePrompt({
        estimate,
        makeDefault: true,
        message
      });
    });
  }, []);

  const getOwnerSignerForRecovery = useCallback(async (): Promise<{
    ownerAddress: string;
    ownerAesKey: string;
    signer: JsonRpcSigner;
  }> => {
    const walletOption = preferredInjectedWalletOption;
    const provider = browserWalletSession?.provider ?? walletOption?.provider ?? null;
    if (!provider) {
      throw new Error('MetaMask or CipherTrade is required to save or recover a ChainWhisper account.');
    }

    if (browserWalletSession?.walletId) {
      setSelectedInjectedWalletId(browserWalletSession.walletId);
    } else if (walletOption?.id) {
      setSelectedInjectedWalletId(walletOption.id);
    }
    const expectedOwnerAddress = browserWalletSession?.address?.trim() ?? '';
    const expectedOwnerKey = expectedOwnerAddress.toLowerCase();
    let accounts = ((await provider.request({ method: 'eth_accounts' })) as string[])
      .filter((account) => isWalletAddress(account));
    if (!accounts.length || (expectedOwnerKey && !accounts.some((account) => account.toLowerCase() === expectedOwnerKey))) {
      accounts = ((await provider.request({ method: 'eth_requestAccounts' })) as string[])
        .filter((account) => isWalletAddress(account));
    }
    const selectedOwnerAddress =
      expectedOwnerKey && accounts.some((account) => account.toLowerCase() === expectedOwnerKey)
        ? expectedOwnerAddress
        : accounts[0] ?? '';
    if (!isWalletAddress(selectedOwnerAddress)) {
      throw new Error('No owner wallet account is available in MetaMask.');
    }
    if (expectedOwnerKey && selectedOwnerAddress.toLowerCase() !== expectedOwnerKey) {
      throw new Error('Select the connected owner wallet in MetaMask before saving or recovering the ChainWhisper account.');
    }
    await ensureCotiNetwork(provider);
    const browserProvider = await createCotiBrowserProvider(provider);
    const signer = await browserProvider.getSigner(selectedOwnerAddress);
    const ownerAddress = await signer.getAddress();
    if (expectedOwnerKey && ownerAddress.toLowerCase() !== expectedOwnerKey) {
      throw new Error('MetaMask returned a different owner wallet than the connected recovery owner.');
    }
    const ownerKey = ownerAddress.toLowerCase();
    const cachedOwnerOnboardInfo = sessionOnboardInfo[ownerKey];
    const cachedOwnerAesKey =
      typeof cachedOwnerOnboardInfo?.aesKey === 'string' ? cachedOwnerOnboardInfo.aesKey.trim() : '';
    if (cachedOwnerAesKey) {
      const onboardInfo = mergeOnboardInfo(signer.getUserOnboardInfo(), cachedOwnerOnboardInfo);
      signer.setUserOnboardInfo(onboardInfo);
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [ownerKey]: mergeOnboardInfo(previous[ownerKey], onboardInfo)
      }));
      setOnboardStatus('Owner Snap AES ready');
      return { ownerAddress, ownerAesKey: cachedOwnerAesKey, signer };
    }
    const snapAesResult = await getCotiSnapOwnerAesKeyResult(provider, ownerAddress);
    if (snapAesResult.status !== 'ready') {
      throw new Error(getCotiSnapOwnerAesStatusMessage(snapAesResult.status));
    }
    const ownerAesKey = snapAesResult.aesKey.trim();
    if (!ownerAesKey) {
      throw new Error('Owner wallet AES key was not returned.');
    }
    const onboardInfo = mergeOnboardInfo(signer.getUserOnboardInfo(), { aesKey: ownerAesKey } as OnboardInfo);
    signer.setUserOnboardInfo(onboardInfo);
    setSessionOnboardInfo((previous) => ({
      ...previous,
      [ownerKey]: mergeOnboardInfo(previous[ownerKey], onboardInfo)
    }));
    setOnboardStatus('Owner Snap AES ready');
    return { ownerAddress, ownerAesKey, signer };
  }, [
    browserWalletSession,
    ensureCotiNetwork,
    preferredInjectedWalletOption,
    sessionOnboardInfo,
    setOnboardStatus,
    setSelectedInjectedWalletId,
    setSessionOnboardInfo
  ]);

  const getConnectedOwnerSignerWithAes = useCallback(
    async (ownerAddress: string, ownerAesKey: string): Promise<JsonRpcSigner> => {
      const ownerKey = ownerAddress.trim().toLowerCase();
      const aesKey = ownerAesKey.trim();
      if (!isWalletAddress(ownerAddress) || !aesKey) {
        throw new Error('Unlock the owner wallet AES key before recovering a ChainWhisper account.');
      }

      const walletOption = preferredInjectedWalletOption;
      const provider = browserWalletSession?.provider ?? walletOption?.provider ?? null;
      if (!provider) {
        throw new Error('MetaMask or CipherTrade is required to recover a ChainWhisper account.');
      }

      if (browserWalletSession?.walletId) {
        setSelectedInjectedWalletId(browserWalletSession.walletId);
      } else if (walletOption?.id) {
        setSelectedInjectedWalletId(walletOption.id);
      }

      const accounts = ((await provider.request({ method: 'eth_accounts' })) as string[])
        .filter((account) => isWalletAddress(account));
      if (!accounts.some((account) => account.toLowerCase() === ownerKey)) {
        throw new Error('Select the connected owner wallet in MetaMask before recovering the ChainWhisper account.');
      }

      await ensureCotiNetwork(provider);
      const browserProvider = await createCotiBrowserProvider(provider);
      const signer = await browserProvider.getSigner(ownerAddress);
      const signerAddress = await signer.getAddress();
      if (signerAddress.toLowerCase() !== ownerKey) {
        throw new Error('MetaMask returned a different owner wallet than the recovery profile owner.');
      }

      const onboardInfo = mergeOnboardInfo(signer.getUserOnboardInfo(), { aesKey } as OnboardInfo);
      signer.setUserOnboardInfo(onboardInfo);
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [ownerKey]: mergeOnboardInfo(previous[ownerKey], onboardInfo)
      }));
      setOnboardStatus('Owner Snap AES ready');
      return signer;
    },
    [
      browserWalletSession,
      ensureCotiNetwork,
      preferredInjectedWalletOption,
      setOnboardStatus,
      setSelectedInjectedWalletId,
      setSessionOnboardInfo
    ]
  );

  const promptToSaveRecoveryProfileNow = useCallback(
    async ({
      ownerAesKey,
      ownerAddress,
      ownerSigner,
      vault
    }: {
      ownerAesKey: string;
      ownerAddress: string;
      ownerSigner: JsonRpcSigner;
      vault: BurnerWalletVault;
    }) => {
      if (!isAppWalletRecoveryConfigured()) {
        return;
      }

      const recoveryVault = await attachActiveBurnerOnboardInfoToVault(vault);
      const recoverySaveChoice = await requestRecoverySaveConfirmation(recoveryVault);
      if (!recoverySaveChoice.shouldSave) {
        setStatus('ChainWhisper account saved locally. Use Save account recovery when you want cross-device recovery.');
        return;
      }

      const saveRecovery = async () => {
        setRecoveringAppWallet(true);
        setStatus('Saving ChainWhisper account recovery...');
        const result = await saveAppWalletRecoveryProfile({
          expectedOwnerAddress: ownerAddress,
          makeDefault: recoverySaveChoice.makeDefault,
          ownerAesKey,
          signer: ownerSigner,
          vault: recoveryVault
        });
        const receipt = result.receipt as { hash?: unknown; transactionHash?: unknown };
        const transactionHash =
          typeof receipt.hash === 'string'
            ? receipt.hash
            : typeof receipt.transactionHash === 'string'
              ? receipt.transactionHash
              : '';
        await persistRecoverySaveMetadata({
          makeDefault: result.verifiedProfile.defaultProfile === true,
          ownerAddress,
          ownerAesKey,
          profileId: result.profileId,
          profileVersion: result.verifiedProfile.version.toString(),
          transactionHash,
          vault: recoveryVault
        });
        setStatus('ChainWhisper account recovery saved and verified.');
      };

      try {
        if (runWalletTransactionFlow) {
          await runWalletTransactionFlow(saveRecovery);
        } else {
          await saveRecovery();
        }
      } catch (recoveryError) {
        setStatus('ChainWhisper account saved locally. Recovery was not saved.');
        setError(getProviderErrorMessage(recoveryError, 'Failed to save ChainWhisper account recovery.'));
      } finally {
        setRecoveringAppWallet(false);
      }
    },
    [
      attachActiveBurnerOnboardInfoToVault,
      persistRecoverySaveMetadata,
      requestRecoverySaveConfirmation,
      runWalletTransactionFlow,
      setError,
      setStatus
    ]
  );

  const initializeOwnerAesBurnerWallet = useCallback(
    async (
      mode: BurnerInitMode,
      seedOrPrivateKey?: string,
      preferredWalletId?: string
    ): Promise<BurnerInitResult> => {
      setError('');
      if (!isBurnerStorageAvailable()) {
        setError('Browser storage is unavailable. Wallet persistence requires local storage access.');
        return 'failed';
      }

      let ownerAddress = '';
      let ownerAesKey = '';
      let ownerSigner: JsonRpcSigner | null = null;
      let burnerVault: BurnerWalletVault | null = null;

      try {
        setInitializingBurner(true);
        setStatus(mode === 'stored' ? 'Unlocking ChainWhisper account...' : 'Saving ChainWhisper account locally...');
        const owner = await getOwnerSignerForRecovery();
        ownerAddress = owner.ownerAddress;
        ownerAesKey = owner.ownerAesKey;
        ownerSigner = owner.signer;

        if (mode === 'stored') {
          burnerVault = await loadBurnerWalletVaultFromOwnerAesStorage(ownerAddress, ownerAesKey);
        } else {
          const burnerRecord = await buildNewBurnerWalletRecord(mode, seedOrPrivateKey);
          burnerVault = await saveBurnerWalletRecordWithOwnerAes(burnerRecord, ownerAddress, ownerAesKey);
        }
        setSavedBurnerWalletCount(burnerVault.wallets.length);
        burnerPinRef.current = '';
      } catch (ownerAesError) {
        setStatus('Disconnected');
        setError(getProviderErrorMessage(ownerAesError, 'Failed to unlock ChainWhisper account with owner wallet.'));
        setOnboardStatus('Not onboarded');
        setInitializingBurner(false);
        return 'failed';
      }

      setInitializingBurner(false);
      if (!burnerVault) {
        setError('Unable to unlock ChainWhisper account.');
        return 'failed';
      }

      const result = await connectBurnerWalletFromVault(burnerVault, preferredWalletId ?? burnerVault.activeWalletId);
      if (result === 'connected' || result === 'needs-funding' || result === 'imported') {
        setShowBurnerPinModal(false);
        setPendingBurnerInit(null);
        setPendingSensitiveAction(null);
        setBurnerPinInput('');
        if (mode === 'import') {
          setShowBurnerImportModal(false);
        }
        schedulePostUnlockRefresh();

        if (mode !== 'stored' && ownerSigner) {
          await promptToSaveRecoveryProfileNow({
            ownerAesKey,
            ownerAddress,
            ownerSigner,
            vault: burnerVault
          });
        }
      }
      return result;
    },
    [
      connectBurnerWalletFromVault,
      getOwnerSignerForRecovery,
      promptToSaveRecoveryProfileNow,
      schedulePostUnlockRefresh,
      setError,
      setOnboardStatus,
      setStatus
    ]
  );

  const beginBurnerPinFlow = useCallback(
    async (mode: BurnerInitMode, seedOrPrivateKey?: string) => {
      setError('');
      setOwnerRecoveryError('');
      refreshBurnerStorageStatus();
      if (!isBurnerStorageAvailable()) {
        setError('Browser storage is unavailable. Wallet persistence requires local storage access.');
        return 'failed';
      }

      const storageState = parseBurnerWalletStorageState();
      if (mode === 'stored' && storageState.kind === 'none') {
        setError('No ChainWhisper account is saved here yet. Generate, import, or recover one first.');
        return 'failed';
      }

      if (mode === 'stored' && storageState.kind === 'owner-aes') {
        return initializeOwnerAesBurnerWallet('stored');
      }

      const canCreateOwnerAesWallet =
        mode !== 'stored' &&
        Boolean(preferredInjectedWalletOption?.provider) &&
        (storageState.kind === 'none' || storageState.kind === 'owner-aes');
      if (canCreateOwnerAesWallet) {
        return initializeOwnerAesBurnerWallet(mode, seedOrPrivateKey);
      }

      if (mode === 'stored' && storageState.kind === 'encrypted' && burnerPinRef.current) {
        return initializeBurnerWallet('stored', undefined, burnerPinRef.current);
      }

      const nextPinMode: BurnerPinMode = storageState.kind === 'encrypted' ? 'unlock' : 'set';

      setPendingBurnerInit({ mode, seedOrPrivateKey });
      setBurnerPinMode(nextPinMode);
      setBurnerPinInput('');
      setShowBurnerPinModal(true);
      return 'pending';
    },
    [
      initializeBurnerWallet,
      initializeOwnerAesBurnerWallet,
      preferredInjectedWalletOption?.provider,
      refreshBurnerStorageStatus,
      setError
    ]
  );

  const saveLinkedRecoveryProfile = useCallback(
    async () => {
      setError('');
      setOwnerRecoveryError('');
      if (!isAppWalletRecoveryConfigured()) {
        setError('ChainWhisper account recovery is not configured yet.');
        return false;
      }
      if (!isBurnerStorageAvailable()) {
        setError('Browser storage is unavailable. ChainWhisper account recovery needs local storage access.');
        return false;
      }

      const activeAppWalletAddress = burnerWalletRef.current?.address ?? burnerRecordRef.current?.address ?? '';
      if (!activeAppWalletAddress || !isWalletAddress(activeAppWalletAddress)) {
        setError('Connect the ChainWhisper account before saving recovery.');
        return false;
      }

      const currentPin = burnerPinRef.current.trim();
      const hasLoadedVault = burnerWallets.some((walletRecord) => walletRecord.privateKey?.trim());
      let vault: BurnerWalletVault | null = null;
      try {
        vault = hasLoadedVault
          ? await createBurnerWalletVault(
              burnerWallets,
              activeBurnerWalletId || burnerRecordRef.current?.id || activeAppWalletAddress
            )
          : currentPin.length >= LEGACY_BURNER_PIN_MIN_LENGTH
            ? await loadBurnerWalletVaultFromStorage(currentPin)
            : null;
      } catch (vaultError) {
        setError(getProviderErrorMessage(vaultError, 'Connect the ChainWhisper account before saving recovery.'));
        return false;
      }
      if (!vault) {
        setError('Connect the ChainWhisper account before saving recovery.');
        return false;
      }

      const recoveryVault = await attachActiveBurnerOnboardInfoToVault(vault);
      const recoverySaveChoice = await requestRecoverySaveConfirmation(recoveryVault);
      if (!recoverySaveChoice.shouldSave) {
        setStatus('ChainWhisper account recovery was not saved.');
        return false;
      }

      const linkRecovery = async () => {
        setRecoveringAppWallet(true);
        setStatus('Saving ChainWhisper account recovery...');
        const { ownerAddress, ownerAesKey, signer: ownerSigner } = await getOwnerSignerForRecovery();
        const result = await saveAppWalletRecoveryProfile({
          expectedOwnerAddress: ownerAddress,
          makeDefault: recoverySaveChoice.makeDefault,
          ownerAesKey,
          signer: ownerSigner,
          vault: recoveryVault
        });
        const receipt = result.receipt as { hash?: unknown; transactionHash?: unknown };
        const transactionHash =
          typeof receipt.hash === 'string'
            ? receipt.hash
            : typeof receipt.transactionHash === 'string'
              ? receipt.transactionHash
              : '';
        await persistRecoverySaveMetadata({
          makeDefault: result.verifiedProfile.defaultProfile === true,
          ownerAddress,
          ownerAesKey,
          profileId: result.profileId,
          profileVersion: result.verifiedProfile.version.toString(),
          transactionHash,
          vault: recoveryVault
        });
        setStatus('ChainWhisper account recovery saved and verified.');
      };

      try {
        if (runWalletTransactionFlow) {
          await runWalletTransactionFlow(linkRecovery);
        } else {
          await linkRecovery();
        }
        return true;
      } catch (recoveryError) {
        setStatus('Connected');
        setError(getProviderErrorMessage(recoveryError, 'Failed to save ChainWhisper account recovery.'));
        return false;
      } finally {
        setRecoveringAppWallet(false);
      }
    },
    [
      activeBurnerWalletId,
      attachActiveBurnerOnboardInfoToVault,
      burnerWallets,
      getOwnerSignerForRecovery,
      persistRecoverySaveMetadata,
      requestRecoverySaveConfirmation,
      runWalletTransactionFlow,
      setError,
      setStatus
    ]
  );

  const buildRecoveredVaultFromProfiles = useCallback(
    async ({
      ownerKey,
      ownerSigner,
      profiles
    }: {
      ownerKey: string;
      ownerSigner: JsonRpcSigner;
      profiles: Awaited<ReturnType<typeof readAppWalletRecoveryProfiles>>;
    }): Promise<{ failedCount: number; vault: BurnerWalletVault }> => {
      const sortedProfiles = [...profiles].sort((left, right) => {
        if (left.defaultProfile && !right.defaultProfile) return -1;
        if (!left.defaultProfile && right.defaultProfile) return 1;
        return left.profileId - right.profileId;
      });
      const recoveredWallets: BurnerWalletRecord[] = [];
      let activeWalletId = '';
      let failedCount = 0;

      for (const profile of sortedProfiles) {
        try {
          const recovered = await decryptAppWalletRecoveryGcProfile(profile, ownerSigner);
          const ownerMarker = recovered.metadata.recoveryOwnerAddress?.trim().toLowerCase() ?? '';
          if (ownerMarker && ownerMarker !== ownerKey) {
            throw new Error('Saved recovery decrypted, but it belongs to a different owner wallet.');
          }

          const recoveredActiveWallet =
            recovered.vault.wallets.find((walletRecord) => walletRecord.id === recovered.vault.activeWalletId) ??
            recovered.vault.wallets[0];
          if (!recoveredActiveWallet?.privateKey?.trim()) {
            throw new Error('Recovered profile did not contain a ChainWhisper account.');
          }

          const walletId =
            recoveredActiveWallet.id?.trim() ||
            recoveredActiveWallet.address?.trim().toLowerCase() ||
            `recovery-profile-${profile.profileId}`;
          recoveredWallets.push({
            ...recoveredActiveWallet,
            id: walletId,
            recoveryDefault: profile.defaultProfile === true,
            recoveryProfileId: profile.profileId,
            recoveryProfileVersion: profile.version.toString()
          });
          if (!activeWalletId || profile.defaultProfile) {
            activeWalletId = walletId;
          }
        } catch {
          failedCount += 1;
        }
      }

      if (recoveredWallets.length === 0) {
        throw new Error(
          'Saved recovery could not be decrypted with the owner COTI privacy key. If this ChainWhisper account is still available locally, use Save account recovery again to repair the on-chain profile.'
        );
      }

      return {
        failedCount,
        vault: await createBurnerWalletVault(recoveredWallets, activeWalletId)
      };
    },
    []
  );

  const recoverLinkedBurnerWalletWithOwnerAes = useCallback(
    async ({
      mode = 'manual',
      ownerAddress,
      ownerAesKey,
      ownerSigner
    }: {
      mode?: OwnerAesRecoveryMode;
      ownerAddress: string;
      ownerAesKey: string;
      ownerSigner?: JsonRpcSigner | null;
    }): Promise<OwnerAesRecoveryResult> => {
      setError('');
      const ownerKey = ownerAddress.trim().toLowerCase();
      const normalizedOwnerAesKey = ownerAesKey.trim();
      if (!isAppWalletRecoveryConfigured()) {
        if (mode === 'manual') {
          const message = 'ChainWhisper account recovery is not configured yet.';
          setError(message);
          setOwnerRecoveryError(message);
        }
        return 'failed';
      }
      if (!isWalletAddress(ownerAddress) || !normalizedOwnerAesKey) {
        if (mode === 'manual') {
          const message = 'Unlock the owner wallet AES key before recovering a ChainWhisper account.';
          setError(message);
          setOwnerRecoveryError(message);
        }
        return 'failed';
      }

      try {
        setOwnerRecoveryError('');
        setRecoveringAppWallet(true);
        setCheckingOwnerRecovery(mode === 'auto');
        setStatus(mode === 'auto' ? 'Checking saved ChainWhisper account...' : 'Recovering ChainWhisper account...');
        const recoveryProfiles = await readAppWalletRecoveryProfiles(ownerAddress);
        if (recoveryProfiles.length === 0) {
          throw new Error(APP_WALLET_RECOVERY_NOT_FOUND_MESSAGE);
        }

        const recoveryAesKey = normalizedOwnerAesKey;
        let recoverySigner = ownerSigner ?? null;
        if (!recoverySigner) {
          recoverySigner = await getConnectedOwnerSignerWithAes(ownerAddress, recoveryAesKey);
        }

        const { failedCount, vault } = await buildRecoveredVaultFromProfiles({
          ownerKey,
          ownerSigner: recoverySigner,
          profiles: recoveryProfiles
        });

        let localRecoverySaved = false;
        let localRecoveryWarning = '';
        if (isBurnerStorageAvailable()) {
          try {
            await saveOwnerAesBurnerWalletVault(vault, ownerKey, recoveryAesKey);
            localRecoverySaved = true;
            setSavedBurnerWalletCount(vault.wallets.length);
          } catch {
            localRecoveryWarning = 'Recovered ChainWhisper account for this session only. It could not be saved locally.';
          }
        } else {
          localRecoveryWarning =
            'Recovered ChainWhisper account for this session only. Browser storage is unavailable, so it was not saved locally.';
        }

        const result = await connectBurnerWalletFromVault(vault, vault.activeWalletId);
        if (result === 'failed') {
          throw new Error(lastBurnerConnectErrorRef.current || 'Recovered ChainWhisper account could not be connected.');
        }
        setOwnerRecoveryError('');
        if (failedCount > 0) {
          setError(
            `${failedCount} saved recovery profile${failedCount === 1 ? '' : 's'} could not be decrypted. Re-save those accounts from a device where they are still available.`
          );
        } else if (!localRecoverySaved && localRecoveryWarning) {
          setError(localRecoveryWarning);
        }
        return 'recovered';
      } catch (recoveryError) {
        if (isAppWalletRecoveryNotFoundError(recoveryError)) {
          setOwnerRecoveryError('');
          if (mode === 'auto') {
            setStatus('Set up ChainWhisper account');
          } else {
            setStatus('Disconnected');
            setError(getProviderErrorMessage(recoveryError, 'No ChainWhisper account recovery was found.'));
          }
          return 'not-found';
        }
        const message = getProviderErrorMessage(recoveryError, 'Failed to recover ChainWhisper account.');
        setStatus(mode === 'auto' ? 'ChainWhisper account setup needed' : 'Disconnected');
        setOwnerRecoveryError(message);
        setError(message);
        return 'failed';
      } finally {
        setCheckingOwnerRecovery(false);
        setRecoveringAppWallet(false);
      }
    },
    [buildRecoveredVaultFromProfiles, connectBurnerWalletFromVault, getConnectedOwnerSignerWithAes, setError, setStatus]
  );

  const bootstrapOwnerLinkedAccount = useCallback(
    async ({
      ownerAddress,
      ownerAesKey,
      ownerSigner
    }: {
      ownerAddress: string;
      ownerAesKey: string;
      ownerSigner?: JsonRpcSigner | null;
    }): Promise<OwnerAesRecoveryResult> => {
      const ownerKey = ownerAddress.trim().toLowerCase();
      const normalizedOwnerAesKey = ownerAesKey.trim();
      if (burnerWalletRef.current) {
        return 'recovered';
      }
      if (!isWalletAddress(ownerAddress) || !normalizedOwnerAesKey) {
        return 'failed';
      }

      const storageState = parseBurnerWalletStorageState();
      if (
        isBurnerStorageAvailable() &&
        storageState.kind === 'owner-aes' &&
        storageState.record.ownerAddress.trim().toLowerCase() === ownerKey
      ) {
        try {
          setError('');
          setOwnerRecoveryError('');
          setCheckingOwnerRecovery(true);
          setRecoveringAppWallet(true);
          setStatus('Checking saved ChainWhisper account...');
          const localVault = await loadBurnerWalletVaultFromOwnerAesStorage(ownerAddress, normalizedOwnerAesKey);
          setSavedBurnerWalletCount(localVault.wallets.length);
          burnerPinRef.current = '';
          const result = await connectBurnerWalletFromVault(localVault, localVault.activeWalletId);
          if (result === 'failed') {
            throw new Error(lastBurnerConnectErrorRef.current || 'Saved ChainWhisper account could not be connected.');
          }
          setOwnerRecoveryError('');
          return 'recovered';
        } catch {
          // Local owner-AES storage may be missing/corrupt on a new or reset browser.
          // Fall through to the on-chain recovery profile for the connected owner.
        } finally {
          setCheckingOwnerRecovery(false);
          setRecoveringAppWallet(false);
        }
      }

      return recoverLinkedBurnerWalletWithOwnerAes({
        mode: 'auto',
        ownerAddress,
        ownerAesKey: normalizedOwnerAesKey,
        ownerSigner
      });
    },
    [connectBurnerWalletFromVault, recoverLinkedBurnerWalletWithOwnerAes, setError, setStatus]
  );

  const recoverLinkedBurnerWalletFromOwner = useCallback(
    async () => {
      setError('');
      if (!isAppWalletRecoveryConfigured()) {
        setError('ChainWhisper account recovery is not configured yet.');
        return false;
      }

      try {
        const { ownerAddress, ownerAesKey, signer: ownerSigner } = await getOwnerSignerForRecovery();
        const result = await recoverLinkedBurnerWalletWithOwnerAes({
          mode: 'manual',
          ownerAddress,
          ownerAesKey,
          ownerSigner
        });
        return result === 'recovered';
      } catch (recoveryError) {
        setStatus('Disconnected');
        setError(getProviderErrorMessage(recoveryError, 'Failed to recover ChainWhisper account.'));
        return false;
      }
    },
    [getOwnerSignerForRecovery, recoverLinkedBurnerWalletWithOwnerAes, setError, setStatus]
  );

  const linkBurnerRecoveryWithWallet = useCallback(async () => {
    setError('');
    if (recoveringAppWallet) {
      return;
    }
    if (!burnerRecordRef.current && !burnerWalletRef.current) {
      setError('Connect the ChainWhisper account before saving recovery.');
      return;
    }
    await saveLinkedRecoveryProfile();
  }, [recoveringAppWallet, saveLinkedRecoveryProfile, setError]);

  const recoverLinkedBurnerWallet = useCallback(async () => {
    setError('');
    if (recoveringAppWallet) {
      return;
    }
    await recoverLinkedBurnerWalletFromOwner();
  }, [recoveringAppWallet, recoverLinkedBurnerWalletFromOwner, setError]);

  const beginLinkExistingPinWallet = useCallback(() => {
    setError('');
    if (recoveringAppWallet || initializingBurner) {
      return;
    }
    const storageState = parseBurnerWalletStorageState();
    if (
      storageState.kind !== 'encrypted' &&
      storageState.kind !== 'legacy' &&
      storageState.kind !== 'legacy-vault'
    ) {
      setError('No PIN-only ChainWhisper account is saved here.');
      return;
    }
    setPendingBurnerInit(null);
    setPendingSensitiveAction('link-pin-account');
    setBurnerPinMode('unlock');
    setBurnerPinInput('');
    setShowBurnerPinModal(true);
  }, [initializingBurner, recoveringAppWallet, setError]);

  const submitBurnerPinAndInitialize = useCallback(async () => {
    setError('');

    const pending = pendingBurnerInit;
    if (!pending) {
      if (pendingSensitiveAction === 'reveal-backup') {
        const pinForReveal = burnerPinInput.trim();
        if (pinForReveal.length < LEGACY_BURNER_PIN_MIN_LENGTH) {
          setError(`PIN must be at least ${LEGACY_BURNER_PIN_MIN_LENGTH} digits.`);
          return;
        }

        try {
          await loadBurnerWalletVaultFromStorage(pinForReveal);
          burnerPinRef.current = pinForReveal;
          setShowBurnerMnemonic(true);
          setShowBurnerPinModal(false);
          setPendingSensitiveAction(null);
          setBurnerPinInput('');
        } catch {
          setError('Invalid PIN. Unable to reveal ChainWhisper account backup.');
        }
        return;
      }

      if (pendingSensitiveAction === 'link-pin-account') {
        const pinForLink = burnerPinInput.trim();
        if (pinForLink.length < LEGACY_BURNER_PIN_MIN_LENGTH) {
          setError(`PIN must be at least ${LEGACY_BURNER_PIN_MIN_LENGTH} digits.`);
          return;
        }

        let ownerAddress = '';
        let ownerAesKey = '';
        let ownerSigner: JsonRpcSigner | null = null;
        let linkedVault: BurnerWalletVault | null = null;
        try {
          setInitializingBurner(true);
          setStatus('Linking existing ChainWhisper account...');
          linkedVault = await loadBurnerWalletVaultFromStorage(pinForLink);
          const owner = await getOwnerSignerForRecovery();
          ownerAddress = owner.ownerAddress;
          ownerAesKey = owner.ownerAesKey;
          ownerSigner = owner.signer;
          await saveOwnerAesBurnerWalletVault(linkedVault, ownerAddress, owner.ownerAesKey);
          setSavedBurnerWalletCount(linkedVault.wallets.length);
          burnerPinRef.current = '';
        } catch (linkError) {
          setStatus('Disconnected');
          setError(getProviderErrorMessage(linkError, 'Failed to link existing ChainWhisper account.'));
          setInitializingBurner(false);
          return;
        }

        setInitializingBurner(false);
        if (!linkedVault) {
          setError('Unable to link existing ChainWhisper account.');
          return;
        }
        const initResult = await connectBurnerWalletFromVault(linkedVault, linkedVault.activeWalletId);
        if (initResult === 'connected' || initResult === 'needs-funding' || initResult === 'imported') {
          setShowBurnerPinModal(false);
          setPendingSensitiveAction(null);
          setBurnerPinInput('');
          schedulePostUnlockRefresh();
          if (ownerSigner) {
            await promptToSaveRecoveryProfileNow({
              ownerAesKey,
              ownerAddress,
              ownerSigner,
              vault: linkedVault
            });
          }
        }
        return;
      }

      if (burnerPinMode !== 'set') {
        return;
      }

      const pinForUpdate = burnerPinInput.trim();
      if (pinForUpdate.length < BURNER_PIN_MIN_LENGTH) {
        setError(`PIN must be at least ${BURNER_PIN_MIN_LENGTH} digits.`);
        return;
      }

      if (!burnerRecordRef.current || burnerWallets.length === 0) {
        setError('Connect the ChainWhisper account first, then change PIN.');
        return;
      }

      await resaveBurnerWalletVaultWithPin(
        burnerWallets,
        pinForUpdate,
        activeBurnerWalletId || burnerRecordRef.current.id || burnerWallets[0]?.id
      );
      burnerPinRef.current = pinForUpdate;
      setShowBurnerPinModal(false);
      setBurnerPinInput('');
      setStatus('ChainWhisper account PIN updated.');
      return;
    }

    const pin = burnerPinInput.trim();
    const minimumPinLength = burnerPinMode === 'unlock' ? LEGACY_BURNER_PIN_MIN_LENGTH : BURNER_PIN_MIN_LENGTH;
    if (pin.length < minimumPinLength) {
      setError(`PIN must be at least ${minimumPinLength} digits.`);
      return;
    }

    const initResult = await initializeBurnerWallet(pending.mode, pending.seedOrPrivateKey, pin, pending.walletId);
    if (initResult === 'connected' || initResult === 'needs-funding' || initResult === 'imported') {
      setShowBurnerPinModal(false);
      setPendingBurnerInit(null);
      setPendingSensitiveAction(null);
      setBurnerPinInput('');

      if (pending.mode === 'import') {
        setShowBurnerImportModal(false);
      }

      schedulePostUnlockRefresh();

      if (initResult === 'connected' && burnerPinMode === 'unlock' && pin.length < BURNER_PIN_MIN_LENGTH) {
        setStatus(`Connected. PIN is legacy; update it to ${BURNER_PIN_MIN_LENGTH}+ digits from Change PIN.`);
      }
    }
  }, [
    activeBurnerWalletId,
    burnerPinInput,
    burnerPinMode,
    burnerWallets,
    connectBurnerWalletFromVault,
    getOwnerSignerForRecovery,
    initializeBurnerWallet,
    pendingBurnerInit,
    pendingSensitiveAction,
    promptToSaveRecoveryProfileNow,
    schedulePostUnlockRefresh,
    setError,
    setStatus
  ]);

  const openChangeBurnerPin = useCallback(() => {
    if (!burnerRecordRef.current) {
      setError('Connect the ChainWhisper account first, then change PIN.');
      return;
    }

    setError('');
    setPendingBurnerInit(null);
    setBurnerPinMode('set');
    setBurnerPinInput('');
    setShowBurnerPinModal(true);
  }, [setError]);

  const importBurnerWallet = useCallback(async () => {
    await beginBurnerPinFlow('import', burnerImportInput);
  }, [beginBurnerPinFlow, burnerImportInput]);

  const switchActiveBurnerWallet = useCallback(
    async (walletIdOrAddress: string) => {
      setError('');

      if (!walletIdOrAddress) {
        return;
      }

      if (!burnerPinRef.current) {
        const hasLoadedVault = burnerWallets.some((walletRecord) => walletRecord.privateKey?.trim());
        if (hasLoadedVault) {
          await connectBurnerWalletFromVault(
            {
              version: BURNER_WALLET_VAULT_VERSION,
              wallets: burnerWallets,
              activeWalletId: activeBurnerWalletId || burnerRecordRef.current?.id || burnerWallets[0]?.id || ''
            },
            walletIdOrAddress
          );
          return;
        }
        const storageState = parseBurnerWalletStorageState();
        if (storageState.kind === 'owner-aes') {
          await initializeOwnerAesBurnerWallet('stored', undefined, walletIdOrAddress);
          return;
        }
        setPendingBurnerInit({ mode: 'stored', walletId: walletIdOrAddress });
        setBurnerPinMode('unlock');
        setBurnerPinInput('');
        setShowBurnerPinModal(true);
        return;
      }

      await initializeBurnerWallet('stored', undefined, burnerPinRef.current, walletIdOrAddress);
    },
    [
      activeBurnerWalletId,
      burnerWallets,
      connectBurnerWalletFromVault,
      initializeBurnerWallet,
      initializeOwnerAesBurnerWallet,
      setError
    ]
  );

  const topUpBurnerWithWallet = useCallback(async (amountOverrideWei?: bigint) => {
    setError('');

    const burnerAddress = burnerWalletRef.current?.address ?? (activeSignerSource === 'burner' ? walletAddress : '');

    if (!burnerAddress || !isWalletAddress(burnerAddress)) {
      const message = 'Initialize the ChainWhisper account first.';
      setError(message);
      throw new Error(message);
    }

    const walletOption = preferredInjectedWalletOption;
    const provider = walletOption?.provider ?? null;
    if (!provider) {
      const message = 'Connect the owner wallet before moving funds.';
      setError(message);
      throw new Error(message);
    }

    const performTopUp = async () => {
      setStatus('Moving funds...');
      if (walletOption?.id) {
        setSelectedInjectedWalletId(walletOption.id);
      }
      await provider.request({ method: 'eth_requestAccounts' });
      await ensureCotiNetwork(provider);

      const browserProvider = await createCotiBrowserProvider(provider);
      const funderSigner = await browserProvider.getSigner();
      let topUpAmount = amountOverrideWei ?? topUpAmountWei;
      if (topUpAmount === null) {
        topUpAmount = calculateEstimatedBurnerTopUpAmount(topUpMessageTarget);
      }

      if (topUpAmount === null) {
        throw new Error('Unable to calculate top-up amount.');
      }
      if (topUpAmount <= 0n) {
        throw new Error('Choose a top-up amount greater than zero.');
      }

      const tx = await funderSigner.sendTransaction({
        to: burnerAddress,
        value: topUpAmount
      });
      await tx.wait();

      setBurnerBalanceWei((previous) => (previous !== null ? previous + topUpAmount : previous));
      setTopUpMetricsNonce((previous) => previous + 1);

      if (burnerPinRef.current) {
        await initializeBurnerWallet(
          'stored',
          undefined,
          burnerPinRef.current,
          burnerRecordRef.current?.id || burnerAddress
        );
      } else if (burnerWallets.some((walletRecord) => walletRecord.privateKey?.trim())) {
        await connectBurnerWalletFromVault(
          {
            version: BURNER_WALLET_VAULT_VERSION,
            wallets: burnerWallets,
            activeWalletId: activeBurnerWalletId || burnerRecordRef.current?.id || burnerWallets[0]?.id || ''
          },
          burnerRecordRef.current?.id || burnerAddress
        );
      } else {
        setStatus('Funds moved. Unlock the ChainWhisper account to continue.');
      }
    };

    try {
      if (runWalletTransactionFlow) {
        await runWalletTransactionFlow(performTopUp);
      } else {
        await performTopUp();
      }
    } catch (fundError) {
      const message = getProviderErrorMessage(fundError, 'Failed to move funds.');
      setError(message);
      setStatus('ChainWhisper account needs funding');
      throw new Error(message);
    }
  }, [
    activeSignerSource,
    activeBurnerWalletId,
    burnerWallets,
    connectBurnerWalletFromVault,
    ensureCotiNetwork,
    initializeBurnerWallet,
    preferredInjectedWalletOption,
    runWalletTransactionFlow,
    setError,
    setSelectedInjectedWalletId,
    setStatus,
    topUpAmountWei,
    topUpMessageTarget,
    walletAddress
  ]);

  const withdrawBurnerToOwnerWallet = useCallback(async (amountWei: bigint) => {
    setError('');
    const signer = burnerWalletRef.current;
    const ownerAddress = browserWalletSession?.address?.trim() ?? '';
    if (!signer || !isWalletAddress(signer.address)) {
      const message = 'Set up the ChainWhisper account before withdrawing.';
      setError(message);
      throw new Error(message);
    }
    if (!isWalletAddress(ownerAddress)) {
      const message = 'Connect the owner wallet before withdrawing.';
      setError(message);
      throw new Error(message);
    }
    if (amountWei <= 0n) {
      const message = 'Choose an amount greater than zero.';
      setError(message);
      throw new Error(message);
    }

    try {
      setStatus('Withdrawing...');
      const tx = await signer.sendTransaction({
        to: ownerAddress,
        value: amountWei
      });
      await tx.wait();
      setBurnerBalanceWei((previous) => (previous !== null && previous >= amountWei ? previous - amountWei : previous));
      setTopUpMetricsNonce((previous) => previous + 1);
      setStatus('Withdrawal complete.');
    } catch (withdrawError) {
      const message = getProviderErrorMessage(withdrawError, 'Failed to withdraw funds.');
      setError(message);
      setStatus('Withdrawal failed');
      throw new Error(message);
    }
  }, [browserWalletSession?.address, setError, setStatus]);

  const resetBurnerSession = useCallback(() => {
    burnerWalletRef.current = null;
    burnerRecordRef.current = null;
    setBurnerNeedsFunding(false);
    setBurnerWallets((previous) =>
      previous.map((walletRecord) => ({
        id: walletRecord.id,
        address: walletRecord.address,
        name: walletRecord.name,
        privateKey: '',
        mnemonic: undefined,
        recoveryDefault: walletRecord.recoveryDefault,
        recoveryProfileId: walletRecord.recoveryProfileId,
        recoveryProfileVersion: walletRecord.recoveryProfileVersion,
        recoveryTransactionHash: walletRecord.recoveryTransactionHash
      }))
    );
    setActiveBurnerWalletId('');
    burnerPinRef.current = '';
  }, []);

  const setActiveRecoveryProfileAsDefault = useCallback(async () => {
    setError('');
    const activeWalletRecord =
      burnerWallets.find((walletRecord) => walletRecord.id === activeBurnerWalletId) ??
      burnerWallets.find((walletRecord) => walletRecord.id === burnerRecordRef.current?.id) ??
      burnerRecordRef.current;
    const profileId = activeWalletRecord?.recoveryProfileId;
    if (typeof profileId !== 'number' || !Number.isSafeInteger(profileId) || profileId < 0) {
      setError('Save this ChainWhisper account recovery before making it the default.');
      return false;
    }

    try {
      setRecoveringAppWallet(true);
      setStatus('Setting default ChainWhisper account...');
      const { ownerAddress, ownerAesKey, signer } = await getOwnerSignerForRecovery();
      await setDefaultAppWalletRecoveryProfile({ profileId, signer });
      const nextVault = await createBurnerWalletVault(
        burnerWallets.map((walletRecord) => ({
          ...walletRecord,
          recoveryDefault: walletRecord.recoveryProfileId === profileId
        })),
        activeWalletRecord?.id || activeBurnerWalletId
      );
      if (isBurnerStorageAvailable()) {
        await saveOwnerAesBurnerWalletVault(nextVault, ownerAddress, ownerAesKey);
      }
      setBurnerWallets(nextVault.wallets);
      setActiveBurnerWalletId(nextVault.activeWalletId);
      setStatus('Default ChainWhisper account updated.');
      return true;
    } catch (defaultError) {
      setStatus('Connected');
      setError(getProviderErrorMessage(defaultError, 'Failed to set default ChainWhisper account.'));
      return false;
    } finally {
      setRecoveringAppWallet(false);
    }
  }, [activeBurnerWalletId, burnerWallets, getOwnerSignerForRecovery, setError, setStatus]);

  const deleteActiveRecoveryProfile = useCallback(async () => {
    setError('');
    const activeWalletRecord =
      burnerWallets.find((walletRecord) => walletRecord.id === activeBurnerWalletId) ??
      burnerWallets.find((walletRecord) => walletRecord.id === burnerRecordRef.current?.id) ??
      burnerRecordRef.current;
    const profileId = activeWalletRecord?.recoveryProfileId;
    if (typeof profileId !== 'number' || !Number.isSafeInteger(profileId) || profileId < 0) {
      setError('This ChainWhisper account is not linked to an on-chain recovery profile yet.');
      return false;
    }
    if (
      !window.confirm(
        'Delete recovery for this ChainWhisper account? The local account stays available on this device.'
      )
    ) {
      return false;
    }

    try {
      setRecoveringAppWallet(true);
      setStatus('Deleting ChainWhisper account recovery...');
      const { ownerAddress, ownerAesKey, signer } = await getOwnerSignerForRecovery();
      await clearAppWalletRecoveryProfile(signer, profileId);
      const remainingWallets = burnerWallets.filter((walletRecord) => walletRecord.recoveryProfileId !== profileId);
      if (remainingWallets.length > 0) {
        const fallbackActiveWallet =
          remainingWallets.find((walletRecord) => walletRecord.recoveryDefault) ?? remainingWallets[0];
        const nextVault = await createBurnerWalletVault(remainingWallets, fallbackActiveWallet?.id);
        if (isBurnerStorageAvailable()) {
          await saveOwnerAesBurnerWalletVault(nextVault, ownerAddress, ownerAesKey);
        }
        setBurnerWallets(nextVault.wallets);
        setActiveBurnerWalletId(nextVault.activeWalletId);
        const result = await connectBurnerWalletFromVault(nextVault, nextVault.activeWalletId);
        if (result === 'failed') {
          throw new Error('Next recovered ChainWhisper account could not be connected.');
        }
      } else {
        if (isBurnerStorageAvailable()) {
          window.localStorage.removeItem(BURNER_WALLET_STORAGE_KEY);
        }
        setBurnerWallets([]);
        setSavedBurnerWalletCount(0);
        resetBurnerSession();
        setStatus('ChainWhisper account recovery deleted. Set up or recover another account.');
      }
      return true;
    } catch (deleteError) {
      setStatus('Connected');
      setError(getProviderErrorMessage(deleteError, 'Failed to delete ChainWhisper account recovery.'));
      return false;
    } finally {
      setRecoveringAppWallet(false);
    }
  }, [
    activeBurnerWalletId,
    burnerWallets,
    connectBurnerWalletFromVault,
    getOwnerSignerForRecovery,
    resetBurnerSession,
    setError,
    setStatus
  ]);

  const burnerAddress = burnerWalletRef.current?.address ?? (activeSignerSource === 'burner' ? walletAddress : '');
  const burnerWalletSelectionValue = activeBurnerWalletId || burnerRecordRef.current?.id || '';

  return {
    activeBurnerWalletId,
    beginBurnerPinFlow,
    beginLinkExistingPinWallet,
    beginRevealBurnerBackup,
    bootstrapOwnerLinkedAccount,
    burnerAddress,
    burnerBalanceWei,
    burnerImportInput,
    burnerNeedsFunding,
    burnerPinInput,
    burnerPinMode,
    burnerRecordRef,
    burnerStorageBlocked,
    burnerWalletRef,
    burnerWalletSelectionValue,
    burnerWallets,
    closeBurnerBackup,
    closeBurnerPinModal,
    confirmRecoverySavePrompt,
    checkingOwnerRecovery,
    cancelRecoverySavePrompt,
    deleteActiveRecoveryProfile,
    importBurnerWallet,
    initializingBurner,
    isAppWalletRecoveryConfigured: isAppWalletRecoveryConfigured(),
    linkBurnerRecoveryWithWallet,
    openChangeBurnerPin,
    ownerRecoveryError,
    recoverySavePrompt,
    recoverLinkedBurnerWallet,
    recoverLinkedBurnerWalletWithOwnerAes,
    recoveringAppWallet,
    resetBurnerSession,
    savedBurnerWalletCount,
    setActiveRecoveryProfileAsDefault,
    setActiveBurnerWalletId,
    setBurnerBalanceWei,
    setBurnerImportInput,
    setBurnerPinInput,
    setBurnerWallets,
    setShowBurnerImportModal,
    setTopUpMetricsNonce,
    setTopUpMessageTarget,
    setRecoverySavePromptMakeDefault,
    showBurnerImportModal,
    showBurnerMnemonic,
    showBurnerPinModal,
    submitBurnerPinAndInitialize,
    switchActiveBurnerWallet,
    topUpBurnerWithWallet,
    topUpMetricsNonce,
    topUpMessageTarget,
    withdrawBurnerToOwnerWallet,
    burnerMnemonicBackup
  };
}
