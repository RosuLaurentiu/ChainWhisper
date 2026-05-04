import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import {
  BURNER_TOP_UP_DEFAULT_MESSAGE_TARGET,
  BURNER_ONBOARD_TIMEOUT_MS,
  BURNER_PIN_MIN_LENGTH,
  calculateEstimatedBurnerTopUpAmount,
  COTI_NETWORK,
  createCotiBrowserProvider,
  getProviderErrorMessage,
  hasInsufficientFundsError,
  isBurnerStorageAvailable,
  isWalletAddress,
  LEGACY_BURNER_PIN_MIN_LENGTH,
  loadBurnerWalletVaultFromStorage,
  loadCotiEthersModule,
  mergeOnboardInfo,
  parseBurnerWalletStorageState,
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
} from '../lib/appShared';
import { saveWalletPreference } from '../lib/appStorage';
import {
  buildNewBurnerWalletRecord,
  loadStoredBurnerWalletRecord,
  resaveBurnerWalletVaultWithPin,
  saveBurnerWalletRecordWithPin
} from '../lib/burnerWalletVault';

type UseBurnerWalletArgs = {
  activeSignerSource: SignerSource;
  currentWalletKeyRef: MutableRefObject<string>;
  ensureCotiNetwork: (provider: Eip1193Provider) => Promise<void>;
  loadMyNicknameFromChainRef: MutableRefObject<(address: string) => Promise<string>>;
  preferredInjectedWalletOption: InjectedWalletOption | null;
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
  currentWalletKeyRef,
  ensureCotiNetwork,
  loadMyNicknameFromChainRef,
  preferredInjectedWalletOption,
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
  const [burnerNeedsFunding, setBurnerNeedsFunding] = useState(false);
  const [burnerBalanceWei, setBurnerBalanceWei] = useState<bigint | null>(null);
  const [topUpMessageTarget, setTopUpMessageTarget] = useState(BURNER_TOP_UP_DEFAULT_MESSAGE_TARGET);
  const [topUpMetricsNonce, setTopUpMetricsNonce] = useState(0);

  const burnerWalletRef = useRef<Wallet | null>(null);
  const burnerRecordRef = useRef<BurnerWalletRecord | null>(null);
  const burnerPinRef = useRef('');

  const refreshBurnerStorageStatus = useCallback(() => {
    setBurnerStorageBlocked(!isBurnerStorageAvailable());
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
            throw new Error('No saved burner wallet found. Generate or import one first.');
          }
          burnerVault = buildResult.vault;
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
          throw new Error('No valid burner wallet was found after unlock.');
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

        burnerWalletRef.current = burnerWallet;
        burnerRecordRef.current = {
          ...burnerRecord,
          address: burnerWallet.address
        };
        setWalletAddress(burnerWallet.address);
        setChainId(COTI_NETWORK.chainIdDecimal);
        setStatus('Connecting burner wallet...');
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
          'Timed out while reading burner wallet balance.'
        )) as bigint;
        if (burnerBalance <= 0n) {
          setBurnerNeedsFunding(true);
          setStatus('Burner wallet created. Fund it, then connect burner wallet.');
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
        await withTimeout(
          burnerWallet.generateOrRecoverAes(),
          BURNER_ONBOARD_TIMEOUT_MS,
          'Timed out while preparing burner wallet encryption keys. Try again.'
        );
        const onboardInfo = burnerWallet.getUserOnboardInfo();

        if (!onboardInfo?.aesKey) {
          throw new Error('AES key unavailable for burner wallet.');
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

        const message = burnerError instanceof Error ? burnerError.message : 'Failed to initialize burner wallet.';
        if (hasInsufficientFundsError(message)) {
          setBurnerNeedsFunding(true);
          setStatus('Burner needs funding');
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
    setPendingSensitiveAction('reveal-backup');
    setBurnerPinMode('unlock');
    setBurnerPinInput('');
    setShowBurnerPinModal(true);
  }, [burnerMnemonicBackup, setError, showBurnerMnemonic]);

  const closeBurnerBackup = useCallback(() => {
    setShowBurnerMnemonic(false);
  }, []);

  const beginBurnerPinFlow = useCallback(
    async (mode: BurnerInitMode, seedOrPrivateKey?: string) => {
      setError('');
      refreshBurnerStorageStatus();
      if (!isBurnerStorageAvailable()) {
        setError('Browser storage is unavailable. Wallet persistence requires local storage access.');
        return;
      }

      const storageState = parseBurnerWalletStorageState();
      if (mode === 'stored' && storageState.kind === 'none') {
        setError('No saved burner wallet found. Generate or import one first.');
        return;
      }

      if (mode === 'stored' && storageState.kind === 'encrypted' && burnerPinRef.current) {
        await initializeBurnerWallet('stored', undefined, burnerPinRef.current);
        return;
      }

      const nextPinMode: BurnerPinMode = storageState.kind === 'encrypted' ? 'unlock' : 'set';

      setPendingBurnerInit({ mode, seedOrPrivateKey });
      setBurnerPinMode(nextPinMode);
      setBurnerPinInput('');
      setShowBurnerPinModal(true);
    },
    [initializeBurnerWallet, refreshBurnerStorageStatus, setError]
  );

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
          setError('Invalid PIN. Unable to reveal burner backup.');
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
        setError('Connect burner wallet first, then change PIN.');
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
      setStatus('Burner PIN updated.');
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
    initializeBurnerWallet,
    pendingBurnerInit,
    pendingSensitiveAction,
    schedulePostUnlockRefresh,
    setError,
    setStatus
  ]);

  const openChangeBurnerPin = useCallback(() => {
    if (!burnerRecordRef.current) {
      setError('Connect burner wallet first, then change PIN.');
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
        setPendingBurnerInit({ mode: 'stored', walletId: walletIdOrAddress });
        setBurnerPinMode('unlock');
        setBurnerPinInput('');
        setShowBurnerPinModal(true);
        return;
      }

      await initializeBurnerWallet('stored', undefined, burnerPinRef.current, walletIdOrAddress);
    },
    [initializeBurnerWallet, setError]
  );

  const topUpBurnerWithWallet = useCallback(async () => {
    setError('');

    const burnerAddress = burnerWalletRef.current?.address ?? (activeSignerSource === 'burner' ? walletAddress : '');

    if (!burnerAddress || !isWalletAddress(burnerAddress)) {
      setError('Initialize burner wallet first.');
      return;
    }

    const walletOption = preferredInjectedWalletOption;
    const provider = walletOption?.provider ?? null;
    if (!provider) {
      setError('MetaMask or CypherTrade is required to top up the app wallet.');
      return;
    }

    try {
      setStatus('Top up in progress...');
      if (walletOption?.id) {
        setSelectedInjectedWalletId(walletOption.id);
      }
      await provider.request({ method: 'eth_requestAccounts' });
      await ensureCotiNetwork(provider);

      const browserProvider = await createCotiBrowserProvider(provider);
      const funderSigner = await browserProvider.getSigner();
      let topUpAmount = topUpAmountWei;
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
      } else {
        setStatus('Burner topped up. Unlock burner wallet to continue.');
      }
    } catch (fundError) {
      const message = getProviderErrorMessage(fundError, 'Failed to top up burner wallet.');
      setError(message);
      setStatus('Burner needs funding');
    }
  }, [
    activeSignerSource,
    ensureCotiNetwork,
    initializeBurnerWallet,
    preferredInjectedWalletOption,
    setError,
    setSelectedInjectedWalletId,
    setStatus,
    topUpAmountWei,
    topUpMessageTarget,
    walletAddress
  ]);

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
        mnemonic: undefined
      }))
    );
    setActiveBurnerWalletId('');
    burnerPinRef.current = '';
  }, []);

  const burnerAddress = burnerWalletRef.current?.address ?? (activeSignerSource === 'burner' ? walletAddress : '');
  const burnerWalletSelectionValue = activeBurnerWalletId || burnerRecordRef.current?.id || '';

  return {
    activeBurnerWalletId,
    beginBurnerPinFlow,
    beginRevealBurnerBackup,
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
    importBurnerWallet,
    initializingBurner,
    openChangeBurnerPin,
    resetBurnerSession,
    savedBurnerWalletCount,
    setActiveBurnerWalletId,
    setBurnerBalanceWei,
    setBurnerImportInput,
    setBurnerPinInput,
    setBurnerWallets,
    setShowBurnerImportModal,
    setTopUpMetricsNonce,
    setTopUpMessageTarget,
    showBurnerImportModal,
    showBurnerMnemonic,
    showBurnerPinModal,
    submitBurnerPinAndInitialize,
    switchActiveBurnerWallet,
    topUpBurnerWithWallet,
    topUpMetricsNonce,
    topUpMessageTarget,
    burnerMnemonicBackup
  };
}
